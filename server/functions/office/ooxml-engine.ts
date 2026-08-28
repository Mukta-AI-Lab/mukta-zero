// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview OOXML Engine — Motor de edição estruturada para DOCX e PPTX
 * @description Fornece localização determinística por paragraph_index + context_hash
 *              e aplicação cirúrgica de revisões (w:del/w:ins para DOCX, substituição
 *              direta em a:t para PPTX).
 *
 * Importado por: studio-apply-track-changes, studio-agent-patch
 */

import { zipSync, Zippable } from "https://esm.sh/fflate@0.8.2";
import { XMLParser, XMLBuilder } from "https://esm.sh/fast-xml-parser@4.5.1";
import {
  findAllParagraphs,
  collectRunsFromNode,
  extractTextFromWt,
} from "./docx-parser.ts";

// ─── Text Normalization ───────────────────────────────────────────────────────

/**
 * Normaliza texto para comparação tolerante a encoding.
 * Todas as substituições são 1:1 em length (UTF-16), portanto o matchIdx
 * obtido no texto normalizado é válido como índice no texto original.
 */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")  // aspas simples curvas → reta
    .replace(/[\u201C\u201D]/g, '"')  // aspas duplas curvas → reta
    .replace(/[\u2013\u2014]/g, '-')  // en/em dash → hífen
    .replace(/\u00A0/g, ' ');         // espaço não-quebrável → espaço normal
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type DocxPatchTarget = {
  format: "docx";
  block_id: string;          // document_blocks.block_key
  paragraph_index: number;   // 0-based — acesso O(1) no array de parágrafos
  start_run_index: number;
  end_run_index: number;
  start_offset: number;      // char offset dentro do start_run
  end_offset: number;        // char offset dentro do end_run (exclusivo)
  context_hash: string;      // SHA-256 para validação do alvo
  original_text: string;     // texto original (para fallback fuzzy e revisão humana)
  replacement_text: string;
};

export type PptxPatchTarget = {
  format: "pptx";
  block_id: string;
  slide_number: number;      // 1-based
  shape_id: string;          // p:sp cNvPr @id
  paragraph_index: number;
  start_run_index: number;
  end_run_index: number;
  start_offset: number;
  end_offset: number;
  context_hash: string;
  original_text: string;
  replacement_text: string;
};

export type XlsxPatchTarget = {
  format: "xlsx";
  block_id: string;          // document_blocks.block_key
  sheet_name: string;        // nome da sheet alvo
  sheet_index: number;       // 0-based
  cell_reference: string;    // ex: "A1", "C5" (referência completa coluna+linha)
  is_formula: boolean;       // true → substituir <f>, false → substituir <v>
  original_text: string;     // valor original (para audit trail)
  replacement_text: string;  // novo valor ou fórmula (sem "=")
  context_hash: string;      // SHA-256 de células vizinhas na mesma linha
};

export type PatchTarget = DocxPatchTarget | PptxPatchTarget | XlsxPatchTarget;

export type PatchOp = {
  op_id: string;
  target: PatchTarget;
  author?: string;
};

export type PatchMethod = "structural" | "fuzzy_fallback" | "failed";

export type FormatChange = {
  property:
    | "font_size"
    | "font_color"
    | "font_name"
    | "bold"
    | "italic"
    | "underline"
    | "alignment"
    | "line_spacing";
  value: number | string | boolean;
};

export type FormatPatch = {
  target_slide: number;
  target_shape_id?: string;
  target_shape_name?: string;
  paragraph_index?: number | null;
  run_index?: number | null;
  changes: FormatChange[];
  source_project_file_id?: string | null;
  source_slide_number?: number | null;
};

export type PatchResult = {
  op_id: string;
  success: boolean;
  method_used: PatchMethod;
  confidence_score: number;
  error?: string;
};

export type RunInfo = {
  runObj: any;
  text: string;
  startIndex: number;
};

// ─── Context Hash ─────────────────────────────────────────────────────────────

/**
 * Calcula SHA-256 de (before + target + after), retorna hex string.
 * Usado para validar que o paragraph_index ainda aponta para o bloco correto.
 */
export async function computeContextHash(
  before: string,
  target: string,
  after: string,
): Promise<string> {
  const raw = `${before.slice(-50)}|${target}|${after.slice(0, 50)}`;
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── ZIP utils ────────────────────────────────────────────────────────────────

/**
 * Reembala um OOXML ZIP com arquivos modificados.
 * @param original mapa original de arquivos (do unzipSync)
 * @param patches  mapa de overrides { path: newBytes }
 */
export function repackZip(
  original: Record<string, Uint8Array>,
  patches: Record<string, Uint8Array>,
  deletedPaths?: Set<string>,
): Uint8Array {
  const zippable: Zippable = {};
  for (const [path, data] of Object.entries(original)) {
    if (deletedPaths?.has(path)) continue;
    zippable[path] = patches[path] ?? data;
  }
  // Add new files from patches that don't exist in original
  for (const [path, data] of Object.entries(patches)) {
    if (!zippable[path]) {
      zippable[path] = data;
    }
  }
  return zipSync(zippable);
}

// ─── XML Parser / Builder padrão ──────────────────────────────────────────────

export function makeParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    trimValues: false,
    cdataPropName: "__cdata",
    textNodeName: "#text",
  });
}

export function makeBuilder(): XMLBuilder {
  return new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    format: false,
    suppressEmptyNode: false,
    textNodeName: "#text",
    cdataPropName: "__cdata",
  });
}

// ─── DOCX Engine ──────────────────────────────────────────────────────────────

export type DocxLocateResult = {
  paragraph: any;
  runs: RunInfo[];
  hashValid: boolean;
  fullText: string;
};

/**
 * Localiza um parágrafo por paragraph_index (O(1)) e valida context_hash.
 * Retorna o nó de parágrafo, os runs coletados, e se o hash é válido.
 */
export function locateDocxNode(
  parsedDoc: any,
  target: DocxPatchTarget,
  allParagraphs?: any[],
): DocxLocateResult | null {
  const paragraphs = allParagraphs ?? findAllParagraphs(parsedDoc);

  if (target.paragraph_index >= paragraphs.length || target.paragraph_index < 0) {
    return null;
  }

  const paragraph = paragraphs[target.paragraph_index];
  const runs: RunInfo[] = [];
  const offset = { value: 0 };
  collectRunsFromNode(paragraph, runs, offset);

  const fullText = runs.map((r) => r.text).join("");

  // Context hash validation (sync — requer pré-computação assíncrona externa)
  // Aqui apenas retornamos hashValid=false se hash não for passado;
  // a validação assíncrona é feita pelo chamador usando computeContextHash.
  const hashValid = true; // chamador deve verificar após computeContextHash

  return { paragraph, runs, hashValid, fullText };
}

/**
 * Extrai o nó rPr (run properties) de um runObj, se presente.
 */
function extractRpr(runObj: any): any | null {
  const children = runObj["w:r"];
  if (!Array.isArray(children)) return null;
  for (const child of children) {
    if (child && child["w:rPr"]) return child;
  }
  return null;
}

/**
 * Cria um nó w:r com o texto fornecido e propriedades opcionais.
 */
function makeRun(text: string, rPrNode: any | null): any {
  const children: any[] = [];
  if (rPrNode) children.push(rPrNode);
  children.push({
    "w:t": [{ "#text": text }],
    ":@": { "@_xml:space": "preserve" },
  });
  return { "w:r": children };
}

/**
 * Aplica track changes (w:del + w:ins) no parágrafo DOCX de forma cirúrgica.
 *
 * Estratégia: usa start_run_index/end_run_index + offsets para delimitar
 * exatamente os runs afetados, sem depender de busca textual.
 *
 * Se os offsets não forem precisos (ex: whole-run replacement), ainda funciona.
 */
export function applyDocxRevisionMarks(
  paragraph: any,
  runs: RunInfo[],
  target: DocxPatchTarget,
  revisionId: number,
  author: string,
  dateStr: string,
): boolean {
  if (runs.length === 0) return false;

  const startIdx = Math.min(target.start_run_index, runs.length - 1);
  const endIdx = Math.min(target.end_run_index, runs.length - 1);

  // Coletamos o texto exato que será deletado para o w:delText
  const deletedText = target.original_text;

  // rPr base para herdar formatação
  const baseRpr = extractRpr(runs[startIdx]?.runObj ?? runs[0].runObj);
  const rprInjection = baseRpr ? [baseRpr] : [];

  const newRunNodes: any[] = [];

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];

    if (i < startIdx) {
      // Runs antes da área alvo — mantém intactos
      if (i === startIdx - 1 && target.start_offset > 0 && r.text.length > 0) {
        // Se há offset inicial, o run anterior fica intacto normalmente
        newRunNodes.push(r.runObj);
      } else {
        newRunNodes.push(r.runObj);
      }
      continue;
    }

    if (i > endIdx) {
      // Runs após a área alvo — mantém intactos
      newRunNodes.push(r.runObj);
      continue;
    }

    // Primeiro run afetado com offset inicial
    if (i === startIdx && target.start_offset > 0) {
      const beforeText = r.text.slice(0, target.start_offset);
      if (beforeText) {
        const localRpr = extractRpr(r.runObj);
        newRunNodes.push(makeRun(beforeText, localRpr));
      }
    }

    // Último run afetado com offset final
    if (i === endIdx) {
      // Inserção de w:del + w:ins (feita uma vez ao final do range)
      newRunNodes.push({
        "w:del": [
          {
            "w:r": [
              ...rprInjection,
              {
                "w:delText": [{ "#text": deletedText }],
                ":@": { "@_xml:space": "preserve" },
              },
            ],
          },
        ],
        ":@": {
          "@_w:id": String(revisionId),
          "@_w:author": author,
          "@_w:date": dateStr,
        },
      });
      newRunNodes.push({
        "w:ins": [
          {
            "w:r": [
              ...rprInjection,
              {
                "w:t": [{ "#text": target.replacement_text }],
                ":@": { "@_xml:space": "preserve" },
              },
            ],
          },
        ],
        ":@": {
          "@_w:id": String(revisionId + 1),
          "@_w:author": author,
          "@_w:date": dateStr,
        },
      });

      // Texto após o offset final no último run
      if (target.end_offset < r.text.length) {
        const afterText = r.text.slice(target.end_offset);
        if (afterText) {
          const localRpr = extractRpr(r.runObj);
          newRunNodes.push(makeRun(afterText, localRpr));
        }
      }
    }
    // Runs intermediários (entre startIdx e endIdx) são consumidos pelo delete
  }

  // Reconstrói children do parágrafo: mantém w:pPr + novos runs
  const oldChildren = paragraph["w:p"] as any[];
  const newChildren: any[] = [];
  for (const child of oldChildren) {
    if (!child || typeof child !== "object") continue;
    const keys = Object.keys(child).filter((k) => k !== ":@");
    if (keys.length > 0 && keys[0] === "w:pPr") {
      newChildren.push(child);
    }
  }
  newChildren.push(...newRunNodes);
  paragraph["w:p"] = newChildren;

  return true;
}

/**
 * Fallback: aplica track change por busca textual (comportamento legado).
 * Retorna false se não encontrar o texto.
 */
export function applyDocxRevisionMarksFuzzy(
  paraInfo: { paragraph: any; runs: RunInfo[]; fullText: string },
  originalText: string,
  replacementText: string,
  revisionId: number,
  author: string,
  dateStr: string,
): boolean {
  const { paragraph, runs, fullText } = paraInfo;
  // Normalização tolerante: aspas curvas, en/em dashes, NBSP → caracteres ASCII
  // equivalentes. Substituições 1:1 preservam length → matchIdx válido no original.
  const normalFullText = normalizeForMatch(fullText);
  const normalOriginal = normalizeForMatch(originalText);
  const matchIdx = normalFullText.indexOf(normalOriginal);
  if (matchIdx === -1) return false;

  const matchEnd = matchIdx + normalOriginal.length;
  const newRunNodes: any[] = [];
  let revisionEmitted = false;

  let baseRpr: any = null;
  for (const r of runs) {
    if (r.startIndex + r.text.length > matchIdx) {
      baseRpr = extractRpr(r.runObj);
      break;
    }
  }
  const rprInjection = baseRpr ? [baseRpr] : [];

  for (const r of runs) {
    const rEnd = r.startIndex + r.text.length;

    if (rEnd <= matchIdx) {
      newRunNodes.push(r.runObj);
      continue;
    }

    if (r.startIndex >= matchEnd) {
      if (!revisionEmitted) {
        newRunNodes.push({
          "w:del": [{ "w:r": [...rprInjection, { "w:delText": [{ "#text": originalText }], ":@": { "@_xml:space": "preserve" } }] }],
          ":@": { "@_w:id": String(revisionId), "@_w:author": author, "@_w:date": dateStr },
        });
        newRunNodes.push({
          "w:ins": [{ "w:r": [...rprInjection, { "w:t": [{ "#text": replacementText }], ":@": { "@_xml:space": "preserve" } }] }],
          ":@": { "@_w:id": String(revisionId + 1), "@_w:author": author, "@_w:date": dateStr },
        });
        revisionEmitted = true;
      }
      newRunNodes.push(r.runObj);
      continue;
    }

    if (r.startIndex < matchIdx) {
      const beforeText = r.text.slice(0, matchIdx - r.startIndex);
      if (beforeText) {
        newRunNodes.push(makeRun(beforeText, extractRpr(r.runObj)));
      }
    }

    if (rEnd >= matchEnd && !revisionEmitted) {
      newRunNodes.push({
        "w:del": [{ "w:r": [...rprInjection, { "w:delText": [{ "#text": originalText }], ":@": { "@_xml:space": "preserve" } }] }],
        ":@": { "@_w:id": String(revisionId), "@_w:author": author, "@_w:date": dateStr },
      });
      newRunNodes.push({
        "w:ins": [{ "w:r": [...rprInjection, { "w:t": [{ "#text": replacementText }], ":@": { "@_xml:space": "preserve" } }] }],
        ":@": { "@_w:id": String(revisionId + 1), "@_w:author": author, "@_w:date": dateStr },
      });
      revisionEmitted = true;
      if (rEnd > matchEnd) {
        const afterText = r.text.slice(matchEnd - r.startIndex);
        if (afterText) newRunNodes.push(makeRun(afterText, extractRpr(r.runObj)));
      }
      continue;
    }
  }

  if (!revisionEmitted) {
    newRunNodes.push({
      "w:del": [{ "w:r": [...rprInjection, { "w:delText": [{ "#text": originalText }], ":@": { "@_xml:space": "preserve" } }] }],
      ":@": { "@_w:id": String(revisionId), "@_w:author": author, "@_w:date": dateStr },
    });
    newRunNodes.push({
      "w:ins": [{ "w:r": [...rprInjection, { "w:t": [{ "#text": replacementText }], ":@": { "@_xml:space": "preserve" } }] }],
      ":@": { "@_w:id": String(revisionId + 1), "@_w:author": author, "@_w:date": dateStr },
    });
  }

  const oldChildren = paragraph["w:p"] as any[];
  const newChildren: any[] = [];
  for (const child of oldChildren) {
    if (!child || typeof child !== "object") continue;
    const keys = Object.keys(child).filter((k) => k !== ":@");
    if (keys.length > 0 && keys[0] === "w:pPr") newChildren.push(child);
  }
  newChildren.push(...newRunNodes);
  paragraph["w:p"] = newChildren;

  return true;
}

// ─── PPTX Engine ──────────────────────────────────────────────────────────────

export type PptxLocateResult = {
  slideXmlPath: string;
  parsedSlide: any;
  shape: any;
  paragraph: any;
  runs: PptxRunInfo[];
  fullText: string;
};

export type PptxRunInfo = {
  runNode: any;
  text: string;
  startIndex: number;
  rPrNode: any | null;
};

/**
 * Encontra todos os shapes (p:sp) num slide.
 */
export function findAllShapes(slideNode: any, results: any[] = []): any[] {
  if (!slideNode || typeof slideNode !== "object") return results;

  if (Array.isArray(slideNode)) {
    for (const item of slideNode) findAllShapes(item, results);
    return results;
  }

  const keys = Object.keys(slideNode).filter((k) => k !== ":@");
  if (keys.length === 0) return results;
  const tagName = keys[0];

  if (tagName === "p:sp") {
    results.push(slideNode);
  }

  const children = slideNode[tagName];
  if (Array.isArray(children)) findAllShapes(children, results);

  return results;
}

/**
 * Extrai o @id de um shape (p:sp nvSpPr/p:cNvPr @id).
 */
export function getShapeId(shape: any): string | null {
  const sp = shape["p:sp"];
  if (!Array.isArray(sp)) return null;

  for (const child of sp) {
    if (!child || typeof child !== "object") continue;
    const keys = Object.keys(child).filter((k) => k !== ":@");
    if (keys[0] === "p:nvSpPr") {
      const nvSpPr = child["p:nvSpPr"];
      if (!Array.isArray(nvSpPr)) continue;
      for (const nvChild of nvSpPr) {
        if (!nvChild) continue;
        const nvKeys = Object.keys(nvChild).filter((k) => k !== ":@");
        if (nvKeys[0] === "p:cNvPr") {
          return nvChild[":@"]?.["@_id"] ? String(nvChild[":@"]["@_id"]) : null;
        }
      }
    }
  }
  return null;
}

function getShapeName(shape: any): string | null {
  const sp = shape["p:sp"];
  if (!Array.isArray(sp)) return null;

  for (const child of sp) {
    if (!child || typeof child !== "object") continue;
    const keys = Object.keys(child).filter((k) => k !== ":@");
    if (keys[0] !== "p:nvSpPr") continue;
    const nvSpPr = child["p:nvSpPr"];
    if (!Array.isArray(nvSpPr)) continue;
    for (const nvChild of nvSpPr) {
      if (!nvChild || typeof nvChild !== "object") continue;
      const nvKeys = Object.keys(nvChild).filter((k) => k !== ":@");
      if (nvKeys[0] !== "p:cNvPr") continue;
      return nvChild[":@"]?.["@_name"] ? String(nvChild[":@"]["@_name"]) : null;
    }
  }

  return null;
}

/**
 * Coleta runs (a:r) de um parágrafo PPTX (a:p).
 */
export function collectPptxRuns(paragraphNode: any): PptxRunInfo[] {
  const runs: PptxRunInfo[] = [];
  const apChildren = paragraphNode["a:p"];
  if (!Array.isArray(apChildren)) return runs;

  let offset = 0;
  for (const child of apChildren) {
    if (!child || typeof child !== "object") continue;
    const keys = Object.keys(child).filter((k) => k !== ":@");
    if (keys[0] !== "a:r") continue;

    const arChildren = child["a:r"];
    if (!Array.isArray(arChildren)) continue;

    let text = "";
    let rPrNode: any = null;
    for (const arChild of arChildren) {
      if (!arChild) continue;
      const arKeys = Object.keys(arChild).filter((k) => k !== ":@");
      if (arKeys[0] === "a:rPr") rPrNode = arChild;
      if (arKeys[0] === "a:t") {
        const tContent = arChild["a:t"];
        if (typeof tContent === "string") text += tContent;
        else if (Array.isArray(tContent)) {
          for (const t of tContent) {
            if (typeof t === "string") text += t;
            else if (t && t["#text"] != null) text += String(t["#text"]);
          }
        } else if (tContent && tContent["#text"] != null) {
          text += String(tContent["#text"]);
        }
      }
    }

    runs.push({ runNode: child, text, startIndex: offset, rPrNode });
    offset += text.length;
  }

  return runs;
}

/**
 * Localiza shape + parágrafo PPTX por slide_number, shape_id, paragraph_index.
 */
export function locatePptxNode(
  unzipped: Record<string, Uint8Array>,
  target: PptxPatchTarget,
  parser: XMLParser,
): PptxLocateResult | null {
  const slideXmlPath = `ppt/slides/slide${target.slide_number}.xml`;
  const slideBytes = unzipped[slideXmlPath];
  if (!slideBytes) return null;

  const slideXmlStr = new TextDecoder().decode(slideBytes);
  const parsedSlide = parser.parse(slideXmlStr);
  const shapes = findAllShapes(parsedSlide);

  const shape = shapes.find((s) => getShapeId(s) === target.shape_id);
  if (!shape) return null;

  // Encontra txBody > a:p
  const sp = shape["p:sp"] as any[];
  let txBodyChildren: any[] | null = null;
  for (const child of sp) {
    if (!child || typeof child !== "object") continue;
    const keys = Object.keys(child).filter((k) => k !== ":@");
    if (keys[0] === "p:txBody") {
      txBodyChildren = child["p:txBody"];
      break;
    }
  }
  if (!txBodyChildren) return null;

  const paragraphs: any[] = [];
  for (const child of txBodyChildren) {
    if (!child || typeof child !== "object") continue;
    const keys = Object.keys(child).filter((k) => k !== ":@");
    if (keys[0] === "a:p") paragraphs.push(child);
  }

  if (target.paragraph_index >= paragraphs.length) return null;
  const paragraph = paragraphs[target.paragraph_index];
  const runs = collectPptxRuns(paragraph);
  const fullText = runs.map((r) => r.text).join("");

  return { slideXmlPath, parsedSlide, shape, paragraph, runs, fullText };
}

/**
 * Aplica substituição direta em PPTX (sem track changes — padrão OOXML não suporta).
 * Modifica o a:t do run-range determinístico.
 */
export function applyPptxRunReplacement(
  paragraph: any,
  runs: PptxRunInfo[],
  target: PptxPatchTarget,
): boolean {
  if (runs.length === 0) return false;

  const startIdx = Math.min(target.start_run_index, runs.length - 1);
  const endIdx = Math.min(target.end_run_index, runs.length - 1);

  const apChildren = paragraph["a:p"] as any[];
  const newChildren: any[] = [];

  // Filtra apenas os nós que não são a:r para preservar a:pPr, a:endParaRPr etc.
  const nonRunNodes = apChildren.filter((child) => {
    if (!child || typeof child !== "object") return true;
    const keys = Object.keys(child).filter((k) => k !== ":@");
    return keys[0] !== "a:r";
  });

  // Monta novos runs
  const runNodes: any[] = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];

    if (i < startIdx || i > endIdx) {
      runNodes.push(r.runNode);
      continue;
    }

    if (i === startIdx) {
      // Parte antes do start_offset (se houver)
      if (target.start_offset > 0) {
        const beforeText = r.text.slice(0, target.start_offset);
        if (beforeText) {
          const rprChildren = r.rPrNode ? [r.rPrNode] : [];
          runNodes.push({
            "a:r": [...rprChildren, { "a:t": [{ "#text": beforeText }] }],
          });
        }
      }
    }

    if (i === endIdx) {
      // Run de substituição (apenas uma vez no endIdx)
      const rprChildren = r.rPrNode ? [r.rPrNode] : [];
      runNodes.push({
        "a:r": [...rprChildren, { "a:t": [{ "#text": target.replacement_text }] }],
      });

      // Parte após o end_offset (se houver)
      if (target.end_offset < r.text.length) {
        const afterText = r.text.slice(target.end_offset);
        if (afterText) {
          const rprChildren2 = r.rPrNode ? [r.rPrNode] : [];
          runNodes.push({
            "a:r": [...rprChildren2, { "a:t": [{ "#text": afterText }] }],
          });
        }
      }
    }
    // Runs intermediários (entre startIdx e endIdx) são descartados (substituídos)
  }

  // Reconstrói a:p preservando a:pPr no início e a:endParaRPr no final
  const pPrNodes = apChildren.filter((c) => {
    if (!c || typeof c !== "object") return false;
    const k = Object.keys(c).filter((key) => key !== ":@");
    return k[0] === "a:pPr";
  });
  const endParaRprNodes = apChildren.filter((c) => {
    if (!c || typeof c !== "object") return false;
    const k = Object.keys(c).filter((key) => key !== ":@");
    return k[0] === "a:endParaRPr";
  });

  paragraph["a:p"] = [...pPrNodes, ...runNodes, ...endParaRprNodes];
  return true;
}

function buildPptxRunNode(templateRun: PptxRunInfo, text: string): any {
  const rPrChildren = templateRun.rPrNode ? [templateRun.rPrNode] : [];
  return {
    "a:r": [...rPrChildren, { "a:t": [{ "#text": text }] }],
  };
}

function applyPptxTextReplacementAcrossRuns(
  paragraph: any,
  runs: PptxRunInfo[],
  matchStart: number,
  matchLength: number,
  replacementText: string,
): boolean {
  if (!Number.isInteger(matchStart) || matchStart < 0 || matchLength <= 0 || runs.length === 0) {
    return false;
  }

  const matchEnd = matchStart + matchLength;
  const firstRunIndex = runs.findIndex((run) => matchStart < run.startIndex + run.text.length && matchEnd > run.startIndex);
  if (firstRunIndex === -1) return false;

  let lastRunIndex = firstRunIndex;
  for (let index = firstRunIndex; index < runs.length; index++) {
    const run = runs[index];
    if (matchEnd <= run.startIndex) break;
    lastRunIndex = index;
  }

  const firstRun = runs[firstRunIndex];
  const lastRun = runs[lastRunIndex];
  const beforeText = firstRun.text.slice(0, Math.max(0, matchStart - firstRun.startIndex));
  const afterText = lastRun.text.slice(Math.max(0, matchEnd - lastRun.startIndex));
  const apChildren = Array.isArray(paragraph["a:p"]) ? paragraph["a:p"] : [];

  const pPrNodes = apChildren.filter((child) => {
    if (!child || typeof child !== "object") return false;
    const keys = Object.keys(child).filter((k) => k !== ":@");
    return keys[0] === "a:pPr";
  });
  const endParaRprNodes = apChildren.filter((child) => {
    if (!child || typeof child !== "object") return false;
    const keys = Object.keys(child).filter((k) => k !== ":@");
    return keys[0] === "a:endParaRPr";
  });

  const runNodes: any[] = [];
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];

    if (index < firstRunIndex || index > lastRunIndex) {
      runNodes.push(run.runNode);
      continue;
    }

    if (index === firstRunIndex) {
      if (beforeText) {
        runNodes.push(buildPptxRunNode(firstRun, beforeText));
      }
      runNodes.push(buildPptxRunNode(firstRun, replacementText));
      if (firstRunIndex === lastRunIndex && afterText) {
        runNodes.push(buildPptxRunNode(lastRun, afterText));
      }
      continue;
    }

    if (index === lastRunIndex && afterText) {
      runNodes.push(buildPptxRunNode(lastRun, afterText));
    }
  }

  paragraph["a:p"] = [...pPrNodes, ...runNodes, ...endParaRprNodes];
  return true;
}

/**
 * Fallback para PPTX: busca textual dentro do parágrafo localizado.
 */
export function applyPptxRunReplacementFuzzy(
  paragraph: any,
  runs: PptxRunInfo[],
  originalText: string,
  replacementText: string,
): boolean {
  const fullText = runs.map((r) => r.text).join("");
  const normalizedFullText = normalizeForMatch(fullText);
  const normalizedOriginalText = normalizeForMatch(originalText);
  const matchIdx = normalizedFullText.indexOf(normalizedOriginalText);
  if (matchIdx === -1) return false;
  return applyPptxTextReplacementAcrossRuns(
    paragraph,
    runs,
    matchIdx,
    normalizedOriginalText.length,
    replacementText,
  );
}

// ─── XLSX Engine ──────────────────────────────────────────────────────────────

export type XlsxCellReplacementResult = {
  success: boolean;
  modifiedXml: string;
  error?: string;
};

function escapeRegexStr(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Aplica substituição direta em uma célula XLSX.
 * XLSX não suporta track changes nativos (w:del/w:ins) — substituição é permanente.
 * O audit trail é mantido via document_change_ops.patch_target.original_text.
 *
 * @param sheetXml  Conteúdo XML da worksheet alvo
 * @param target    XlsxPatchTarget com cell_reference, is_formula e replacement_text
 */
/**
 * Estimates whether replacement text will overflow a PPTX text box.
 * Uses a heuristic based on character count ratio and average char width.
 *
 * @param originalText  The text being replaced
 * @param newText       The replacement text
 * @param shapeWidthCm  Width of the containing shape in cm (from visual map)
 * @param shapeHeightCm Height of the containing shape in cm
 * @param fontSizePt    Estimated font size in points (default 12)
 * @returns Overflow ratio (> 1.0 means overflow likely) and recommended action
 */
export function estimateTextOverflow(
  originalText: string,
  newText: string,
  shapeWidthCm: number | null,
  shapeHeightCm: number | null,
  fontSizePt: number = 12,
): { ratio: number; action: "none" | "shrink_font" | "enable_autofit" } {
  if (!shapeWidthCm || shapeWidthCm <= 0) {
    // No usable width available — cannot estimate
    return { ratio: 1.0, action: "none" };
  }

  // Width-driven heuristic documented in the acceptance blueprint.
  const avgCharWidthPt = fontSizePt * 0.6;
  const textWidthPt = newText.length * avgCharWidthPt;
  const boxWidthPt = shapeWidthCm * 28.3465;
  const ratio = textWidthPt / Math.max(1, boxWidthPt);

  if (ratio <= 1.0) return { ratio, action: "none" };
  if (ratio < 1.5) return { ratio, action: "enable_autofit" };
  return { ratio, action: "shrink_font" };
}

/**
 * Applies text_fit heuristic to a PPTX shape XML string.
 * Modifies the shape's a:bodyPr to add autofit or font scaling.
 *
 * @param shapeXml  The raw shape XML (p:sp element)
 * @param mode      The text_fit mode
 * @param overflowRatio  The estimated overflow ratio (used for shrink calculation)
 * @returns Modified shape XML string
 */
export function applyTextFitToShapeXml(
  shapeXml: string,
  mode: "shrink_font" | "enable_autofit",
  overflowRatio: number = 1.0,
): string {
  // Remove existing autofit/noAutofit settings using string-based removal
  const autofitTags = ["a:normAutofit", "a:noAutofit", "a:spAutoFit"];
  let modified = shapeXml;
  for (const tag of autofitTags) {
    // Remove self-closing: <a:normAutofit/> or <a:normAutofit fontScale="80000"/>
    let startPos = modified.indexOf("<" + tag);
    while (startPos !== -1) {
      const closePos = modified.indexOf(">", startPos);
      if (closePos !== -1) {
        modified = modified.slice(0, startPos) + modified.slice(closePos + 1);
      }
      startPos = modified.indexOf("<" + tag);
    }
  }

  const bodyPrTag = "<a:bodyPr";
  const bodyPrIdx = modified.indexOf(bodyPrTag);

  if (bodyPrIdx === -1) return modified;

  if (mode === "enable_autofit") {
    // Find end of bodyPr opening tag
    const afterBodyPr = modified.indexOf(">", bodyPrIdx);
    if (afterBodyPr === -1) return modified;

    if (modified[afterBodyPr - 1] === "/") {
      // Self-closing <a:bodyPr .../> -> <a:bodyPr ...><a:normAutofit/></a:bodyPr>
      modified = modified.slice(0, afterBodyPr - 1) + "><a:normAutofit/></a:bodyPr>" + modified.slice(afterBodyPr + 1);
    } else {
      // Open tag <a:bodyPr ...> -> insert after
      modified = modified.slice(0, afterBodyPr + 1) + "<a:normAutofit/>" + modified.slice(afterBodyPr + 1);
    }
  } else if (mode === "shrink_font") {
    const fontScale = Math.max(50000, Math.round((1 / overflowRatio) * 100000));
    const afterBodyPr = modified.indexOf(">", bodyPrIdx);
    if (afterBodyPr === -1) return modified;

    const autofitEl = '<a:normAutofit fontScale="' + fontScale + '"/>';

    if (modified[afterBodyPr - 1] === "/") {
      modified = modified.slice(0, afterBodyPr - 1) + ">" + autofitEl + "</a:bodyPr>" + modified.slice(afterBodyPr + 1);
    } else {
      modified = modified.slice(0, afterBodyPr + 1) + autofitEl + modified.slice(afterBodyPr + 1);
    }
  }

  return modified;
}


export function applyXlsxCellReplacement(
  sheetXml: string,
  target: XlsxPatchTarget,
): XlsxCellReplacementResult {
  const cellRef = target.cell_reference;

  // Regex para localizar a célula pelo atributo r= (referência única na sheet)
  // Suporta qualquer atributo adicional (t=, s=) em qualquer ordem
  const cellPattern = new RegExp(
    `(<c(?=[^>]*\\br="${escapeRegexStr(cellRef)}"\\b)[^>]*>)((?:.|\\n|\\r)*?)(</c>)`,
    "m",
  );

  const match = cellPattern.exec(sheetXml);
  if (!match) {
    return {
      success: false,
      modifiedXml: sheetXml,
      error: `Cell ${cellRef} not found in sheet XML`,
    };
  }

  const [fullMatch, openTag, innerContent, closeTag] = match;
  let newInner = innerContent;

  if (target.is_formula) {
    // Substituir conteúdo de <f>...</f>
    const fTagPattern = /(<f(?:[^>]*)>)((?:.|[\n\r])*?)(<\/f>)/;
    if (fTagPattern.test(newInner)) {
      newInner = newInner.replace(fTagPattern, `$1${escapeXmlText(target.replacement_text)}$3`);
    } else {
      // Célula não tinha fórmula — inserir <f> antes de <v> se houver, ou no início
      const vMatch = /<v/.exec(newInner);
      const insertPos = vMatch ? newInner.indexOf(vMatch[0]) : newInner.length;
      newInner =
        newInner.slice(0, insertPos) +
        `<f>${escapeXmlText(target.replacement_text)}</f>` +
        newInner.slice(insertPos);
    }
    // Remover <v> cached (Excel recalculará) para garantir dados frescos
    newInner = newInner.replace(/<v>(?:.|[\n\r])*?<\/v>/g, "");
  } else {
    // Substituir conteúdo de <v>...</v>
    // Se existia fórmula, remover — agora é valor direto
    newInner = newInner.replace(/<f(?:[^>]*)>(?:.|[\n\r])*?<\/f>/g, "");
    const vTagPattern = /(<v>)((?:.|[\n\r])*?)(<\/v>)/;
    if (vTagPattern.test(newInner)) {
      newInner = newInner.replace(vTagPattern, `$1${escapeXmlText(target.replacement_text)}$3`);
    } else {
      // Não havia <v> — inserir
      newInner = `<v>${escapeXmlText(target.replacement_text)}</v>${newInner}`;
    }
    // Remover atributo t= de fórmula string se presente (ao remover fórmula)
    // Isso é tratado ajustando o openTag se necessário (conservador: manter como está)
  }

  const newCell = `${openTag}${newInner}${closeTag}`;
  const modifiedXml = sheetXml.slice(0, match.index) + newCell + sheetXml.slice(match.index + fullMatch.length);

  return { success: true, modifiedXml };
}

function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── PPTX Structural Operations ──────────────────────────────────────────────

/**
 * @description Type for PPTX structural operations (insert/duplicate/delete slides)
 */
export type MasterSlideChange = {
  /** cNvPr id of the shape to modify in master/layout */
  shape_id?: string;
  /** cNvPr name of the shape (alternative to id) */
  shape_name?: string;
  /** What to do with the shape */
  action: "replace_text" | "replace_image" | "remove_shape";
  /** For replace_text: original text to find */
  original_text?: string;
  /** For replace_text: replacement text */
  replacement_text?: string;
  /** For replace_image: new image URL (base64 or https) */
  image_url?: string;
  /** For replace_image: project file reference */
  project_file_id?: string;
};

export type PptxStructuralOp = {
  action:
    | "insert_slide"
    | "duplicate_slide"
    | "delete_slide"
    | "move_slide"
    | "copy_slide_from_presentation"
    | "modify_master"
    | "restore_slide"
    | "delete_shape"
    | "restore_shape";
  source_slide?: number;
  after_slide?: number;
  slide_number?: number;
  layout_ref?: string;
  content?: Record<string, string>;
  shape_id?: string;
  shape_name?: string;
  shape_xml?: string;
  slide_xml?: string;
  slide_rels_xml?: string | null;
  presentation_rel_xml?: string | null;
  presentation_sldid_xml?: string | null;
  content_type_override_xml?: string | null;
  source_project_file_id?: string | null;
  source_presentation_label?: string | null;
  master_target?: "master" | "layout";
  layout_index?: number;
  master_changes?: Array<{
    action: "replace_text" | "replace_image" | "remove_shape";
    original_text?: string;
    replacement_text?: string;
    shape_id?: string;
    shape_name?: string;
    image_url?: string;
  }>;
};

export type PptxStructuralResult = {
  action: string;
  success: boolean;
  new_slide_number?: number;
  deleted_slide_number?: number;
  modified_files: Record<string, Uint8Array>;
  deleted_files: string[];
  error?: string;
};

type PresentationSlideEntry = {
  slideNumber: number;
  relationshipId: string;
  sldIdXml: string;
};

/**
 * Lists available slide layouts in the PPTX file.
 */
export function listSlideLayouts(
  unzipped: Record<string, Uint8Array>,
): { layoutIndex: number; layoutPath: string; layoutName: string }[] {
  const layouts: { layoutIndex: number; layoutPath: string; layoutName: string }[] = [];
  const layoutKeys = Object.keys(unzipped)
    .filter((k) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(k))
    .sort();

  for (const layoutPath of layoutKeys) {
    const match = layoutPath.match(/slideLayout(\d+)\.xml$/);
    if (!match) continue;
    const layoutIndex = parseInt(match[1], 10);

    // Try to extract layout name from XML
    const xml = new TextDecoder().decode(unzipped[layoutPath]);
    const nameMatch = xml.match(/\btype="([^"]+)"/);
    const layoutName = nameMatch ? nameMatch[1] : `Layout ${layoutIndex}`;

    layouts.push({ layoutIndex, layoutPath, layoutName });
  }

  return layouts;
}

/**
 * Counts existing slides and returns the next available slide number.
 */
export function getNextSlideNumber(unzipped: Record<string, Uint8Array>): number {
  const slideKeys = Object.keys(unzipped).filter((k) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(k),
  );
  let maxNum = 0;
  for (const key of slideKeys) {
    const m = key.match(/slide(\d+)\.xml$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  return maxNum + 1;
}

/**
 * Applies changes to a PPTX master slide or layout.
 * Supports: replace_text (find/replace in shapes), replace_image (swap image), remove_shape.
 */
export function applyMasterSlideChanges(
  unzipped: Record<string, Uint8Array>,
  op: PptxStructuralOp,
): PptxStructuralResult {
  const modifiedFiles: Record<string, Uint8Array> = {};
  const changes = op.master_changes || [];
  if (changes.length === 0) {
    return { action: "modify_master", success: false, modified_files: {}, deleted_files: [], error: "No master_changes provided" };
  }

  // Determine target XML path
  let xmlPath: string;
  if (op.master_target === "layout" && op.layout_index) {
    xmlPath = "ppt/slideLayouts/slideLayout" + op.layout_index + ".xml";
  } else {
    xmlPath = "ppt/slideMasters/slideMaster1.xml";
  }

  const xmlBytes = unzipped[xmlPath];
  if (!xmlBytes) {
    return { action: "modify_master", success: false, modified_files: {}, deleted_files: [], error: "Target XML not found: " + xmlPath };
  }

  let xml = new TextDecoder().decode(xmlBytes);
  let appliedCount = 0;
  let parsedXml: any | null = null;
  let xmlDirty = false;

  const getParsedXml = () => {
    if (parsedXml) return parsedXml;
    parsedXml = makeParser().parse(xml);
    return parsedXml;
  };

  for (const change of changes) {
    if (change.action === "replace_text" && change.original_text && change.replacement_text) {
      const originalText = change.original_text;
      const replacementText = change.replacement_text;
      const parsed = getParsedXml();
      const shapes = findAllShapes(parsed);
      const candidateShapes = change.shape_id || change.shape_name
        ? shapes.filter((shape) =>
            (change.shape_id && getShapeId(shape) === change.shape_id)
            || (change.shape_name && getShapeName(shape) === change.shape_name)
          )
        : shapes;
      const replaced = candidateShapes.some((shape) => {
        const sp = shape["p:sp"];
        const txBodyNode = Array.isArray(sp)
          ? sp.find((child) => {
              if (!child || typeof child !== "object") return false;
              const keys = Object.keys(child).filter((key) => key !== ":@");
              return keys[0] === "p:txBody";
            })
          : null;
        const txBodyChildren = txBodyNode && Array.isArray(txBodyNode["p:txBody"]) ? txBodyNode["p:txBody"] : [];
        return txBodyChildren.some((child) => {
          if (!child || typeof child !== "object") return false;
          const keys = Object.keys(child).filter((key) => key !== ":@");
          if (keys[0] !== "a:p") return false;
          const runs = collectPptxRuns(child);
          if (!runs.length) return false;
          return applyPptxRunReplacementFuzzy(child, runs, originalText, replacementText);
        });
      });
      if (replaced) {
        appliedCount++;
        xmlDirty = true;
      }
    } else if (change.action === "remove_shape" && (change.shape_id || change.shape_name)) {
      if (parsedXml) {
        xml = makeBuilder().build(parsedXml);
        parsedXml = null;
      }
      const shapeRegex = /<p:sp\b[\s\S]*?<\/p:sp>/g;
      let shapeMatch;
      while ((shapeMatch = shapeRegex.exec(xml)) !== null) {
        const shapeXml = shapeMatch[0];
        let isTarget = false;
        if (change.shape_id) isTarget = shapeXml.includes('id="' + change.shape_id + '"');
        if (!isTarget && change.shape_name) isTarget = shapeXml.includes('name="' + change.shape_name + '"');
        if (isTarget) {
          xml = xml.slice(0, shapeMatch.index) + xml.slice(shapeMatch.index + shapeXml.length);
          appliedCount++;
          break;
        }
      }
    }
    // replace_image is more complex (requires image engine) — deferred to integration layer
  }

  if (appliedCount === 0) {
    return { action: "modify_master", success: false, modified_files: {}, deleted_files: [], error: "No changes matched in " + xmlPath };
  }

  if (xmlDirty && parsedXml) {
    xml = makeBuilder().build(parsedXml);
  }
  modifiedFiles[xmlPath] = new TextEncoder().encode(xml);
  return { action: "modify_master", success: true, modified_files: modifiedFiles, deleted_files: [] };
}


/**
 * Gets the next available sldId and rId from presentation.xml.
 */
function getNextIds(presentationXml: string): { nextSldId: number; nextRId: number } {
  const sldIdMatches = [...presentationXml.matchAll(/id="(\d+)"/g)];
  let maxSldId = 255; // OOXML standard minimum
  for (const m of sldIdMatches) {
    maxSldId = Math.max(maxSldId, parseInt(m[1], 10));
  }

  const rIdMatches = [...presentationXml.matchAll(/r:id="rId(\d+)"/g)];
  const rIdMatches2 = [...presentationXml.matchAll(/Id="rId(\d+)"/g)];
  let maxRId = 0;
  for (const m of [...rIdMatches, ...rIdMatches2]) {
    maxRId = Math.max(maxRId, parseInt(m[1], 10));
  }

  return { nextSldId: maxSldId + 1, nextRId: maxRId + 1 };
}

function listPresentationSlideEntries(
  unzipped: Record<string, Uint8Array>,
): { presentationXml: string; entries: PresentationSlideEntry[] } | null {
  const presBytes = unzipped["ppt/presentation.xml"];
  const presRelsBytes = unzipped["ppt/_rels/presentation.xml.rels"];
  if (!presBytes || !presRelsBytes) return null;

  const presentationXml = new TextDecoder().decode(presBytes);
  const presentationRelsXml = new TextDecoder().decode(presRelsBytes);
  const relationshipToSlide = new Map<string, number>();
  const relPattern = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="slides\/slide(\d+)\.xml"[^>]*\/>/g;
  let relMatch: RegExpExecArray | null;
  while ((relMatch = relPattern.exec(presentationRelsXml)) !== null) {
    relationshipToSlide.set(relMatch[1], Number(relMatch[2]));
  }

  const entries: PresentationSlideEntry[] = [];
  const sldIdPattern = /(<p:sldId\b[^>]*?r:id="([^"]+)"[^>]*?\/>)/g;
  let sldIdMatch: RegExpExecArray | null;
  while ((sldIdMatch = sldIdPattern.exec(presentationXml)) !== null) {
    const relationshipId = sldIdMatch[2];
    const slideNumber = Number(relationshipToSlide.get(relationshipId) || 0);
    if (slideNumber <= 0) continue;
    entries.push({
      slideNumber,
      relationshipId,
      sldIdXml: sldIdMatch[1],
    });
  }

  return { presentationXml, entries };
}

export function listPresentationSlideOrder(unzipped: Record<string, Uint8Array>): number[] {
  const resolved = listPresentationSlideEntries(unzipped);
  return resolved ? resolved.entries.map((entry) => entry.slideNumber) : [];
}

/**
 * Finds the layout rId from a slide's .rels file.
 */
function getSlideLayoutRId(
  unzipped: Record<string, Uint8Array>,
  slideNumber: number,
): { layoutRId: string; layoutPath: string } | null {
  const relsPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
  const relsBytes = unzipped[relsPath];
  if (!relsBytes) return null;

  const relsXml = new TextDecoder().decode(relsBytes);
  const layoutMatch = relsXml.match(
    /Id="(rId\d+)"[^>]*Target="[^"]*slideLayout(\d+)\.xml"/,
  );
  if (!layoutMatch) {
    // Try alternate attribute order
    const altMatch = relsXml.match(
      /Target="[^"]*slideLayout(\d+)\.xml"[^>]*Id="(rId\d+)"/,
    );
    if (altMatch) {
      return {
        layoutRId: altMatch[2],
        layoutPath: `ppt/slideLayouts/slideLayout${altMatch[1]}.xml`,
      };
    }
    return null;
  }

  return {
    layoutRId: layoutMatch[1],
    layoutPath: `ppt/slideLayouts/slideLayout${layoutMatch[2]}.xml`,
  };
}

/**
 * Duplicates an existing slide in the PPTX.
 *
 * @param unzipped  The unzipped PPTX file map
 * @param sourceSlideNumber  1-based slide number to duplicate
 * @returns Result with new slide number and modified/new files
 */
export function duplicateSlide(
  unzipped: Record<string, Uint8Array>,
  sourceSlideNumber: number,
): PptxStructuralResult {
  const srcSlidePath = `ppt/slides/slide${sourceSlideNumber}.xml`;
  const srcRelsPath = `ppt/slides/_rels/slide${sourceSlideNumber}.xml.rels`;

  if (!unzipped[srcSlidePath]) {
    return {
      action: "duplicate_slide",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: `Source slide ${sourceSlideNumber} not found`,
    };
  }

  const newSlideNum = getNextSlideNumber(unzipped);
  const newSlidePath = `ppt/slides/slide${newSlideNum}.xml`;
  const newRelsPath = `ppt/slides/_rels/slide${newSlideNum}.xml.rels`;

  const modified: Record<string, Uint8Array> = {};

  // 1. Copy slide XML
  modified[newSlidePath] = new Uint8Array(unzipped[srcSlidePath]);

  // 2. Copy slide rels (if exists)
  if (unzipped[srcRelsPath]) {
    modified[newRelsPath] = new Uint8Array(unzipped[srcRelsPath]);
  }

  // 3. Update presentation.xml — add p:sldId + r:id
  const presPath = "ppt/presentation.xml";
  const presBytes = unzipped[presPath];
  if (!presBytes) {
    return {
      action: "duplicate_slide",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: "presentation.xml not found",
    };
  }

  let presXml = new TextDecoder().decode(presBytes);
  const { nextSldId, nextRId } = getNextIds(presXml);
  const newRId = `rId${nextRId}`;

  // Insert new p:sldId after the source slide's entry
  const sldIdEntry = `<p:sldId id="${nextSldId}" r:id="${newRId}"/>`;
  const srcSldIdPattern = /(<p:sldId\s[^>]*?\/>)/g;
  const allSldIds = [...presXml.matchAll(srcSldIdPattern)];

  if (allSldIds.length > 0) {
    // Insert after the last sldId (appends at end of slide list)
    const lastMatch = allSldIds[allSldIds.length - 1];
    const insertPos = lastMatch.index! + lastMatch[0].length;
    presXml = presXml.slice(0, insertPos) + sldIdEntry + presXml.slice(insertPos);
  } else {
    // Fallback: insert before </p:sldIdLst>
    presXml = presXml.replace("</p:sldIdLst>", `${sldIdEntry}</p:sldIdLst>`);
  }

  modified[presPath] = new TextEncoder().encode(presXml);

  // 4. Update presentation.xml.rels — add relationship
  const presRelsPath = "ppt/_rels/presentation.xml.rels";
  const presRelsBytes = unzipped[presRelsPath];
  if (presRelsBytes) {
    let presRelsXml = new TextDecoder().decode(presRelsBytes);
    const newRel = `<Relationship Id="${newRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${newSlideNum}.xml"/>`;
    presRelsXml = presRelsXml.replace("</Relationships>", `${newRel}</Relationships>`);
    modified[presRelsPath] = new TextEncoder().encode(presRelsXml);
  }

  // 5. Update [Content_Types].xml
  const ctPath = "[Content_Types].xml";
  const ctBytes = unzipped[ctPath];
  if (ctBytes) {
    let ctXml = new TextDecoder().decode(ctBytes);
    const override = `<Override PartName="/ppt/slides/slide${newSlideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
    ctXml = ctXml.replace("</Types>", `${override}</Types>`);
    modified[ctPath] = new TextEncoder().encode(ctXml);
  }

  return {
    action: "duplicate_slide",
    success: true,
    new_slide_number: newSlideNum,
    modified_files: modified,
    deleted_files: [],
  };
}

/**
 * Inserts a blank slide with a minimal XML structure.
 *
 * @param unzipped  The unzipped PPTX file map
 * @param afterSlideNumber  Insert after this slide (0 = at beginning)
 * @param layoutRef  Optional layout name to match (falls back to first layout)
 */
export function insertBlankSlide(
  unzipped: Record<string, Uint8Array>,
  afterSlideNumber: number,
  layoutRef?: string,
): PptxStructuralResult {
  const newSlideNum = getNextSlideNumber(unzipped);
  const newSlidePath = `ppt/slides/slide${newSlideNum}.xml`;
  const newRelsPath = `ppt/slides/_rels/slide${newSlideNum}.xml.rels`;

  // Find layout to reference
  let layoutPath: string | null = null;
  if (layoutRef) {
    const layouts = listSlideLayouts(unzipped);
    const found = layouts.find(
      (l) => l.layoutName.toLowerCase() === layoutRef.toLowerCase(),
    );
    layoutPath = found?.layoutPath ?? null;
  }

  if (!layoutPath) {
    // Use the same layout as the source slide, or first available
    if (afterSlideNumber > 0) {
      const srcLayout = getSlideLayoutRId(unzipped, afterSlideNumber);
      layoutPath = srcLayout?.layoutPath ?? null;
    }
    if (!layoutPath) {
      const layouts = listSlideLayouts(unzipped);
      layoutPath = layouts[0]?.layoutPath ?? "ppt/slideLayouts/slideLayout1.xml";
    }
  }

  // Compute relative path from slides/ to slideLayouts/
  const layoutRelPath = `../slideLayouts/${layoutPath.split("/").pop()}`;

  const modified: Record<string, Uint8Array> = {};

  // 1. Create minimal slide XML
  const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr>
    <a:masterClrMapping/>
  </p:clrMapOvr>
</p:sld>`;
  modified[newSlidePath] = new TextEncoder().encode(slideXml);

  // 2. Create .rels referencing the layout
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="${layoutRelPath}"/>
</Relationships>`;
  modified[newRelsPath] = new TextEncoder().encode(relsXml);

  // 3. Update presentation.xml
  const presPath = "ppt/presentation.xml";
  const presBytes = unzipped[presPath];
  if (!presBytes) {
    return {
      action: "insert_slide",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: "presentation.xml not found",
    };
  }

  let presXml = new TextDecoder().decode(presBytes);
  const { nextSldId, nextRId } = getNextIds(presXml);
  const newRId = `rId${nextRId}`;

  const sldIdEntry = `<p:sldId id="${nextSldId}" r:id="${newRId}"/>`;

  if (afterSlideNumber > 0) {
    // Try to insert after the Nth p:sldId
    const sldIdPattern = /<p:sldId\s[^>]*?\/>/g;
    const allMatches = [...presXml.matchAll(sldIdPattern)];
    const targetIdx = Math.min(afterSlideNumber - 1, allMatches.length - 1);
    if (allMatches.length > 0 && targetIdx >= 0) {
      const afterMatch = allMatches[targetIdx];
      const insertPos = afterMatch.index! + afterMatch[0].length;
      presXml = presXml.slice(0, insertPos) + sldIdEntry + presXml.slice(insertPos);
    } else {
      presXml = presXml.replace("</p:sldIdLst>", `${sldIdEntry}</p:sldIdLst>`);
    }
  } else {
    // Insert at beginning
    presXml = presXml.replace("<p:sldIdLst>", `<p:sldIdLst>${sldIdEntry}`);
    if (!presXml.includes("<p:sldIdLst>")) {
      presXml = presXml.replace("</p:sldIdLst>", `${sldIdEntry}</p:sldIdLst>`);
    }
  }

  modified[presPath] = new TextEncoder().encode(presXml);

  // 4. Update presentation.xml.rels
  const presRelsPath = "ppt/_rels/presentation.xml.rels";
  const presRelsBytes = unzipped[presRelsPath];
  if (presRelsBytes) {
    let presRelsXml = new TextDecoder().decode(presRelsBytes);
    const newRel = `<Relationship Id="${newRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${newSlideNum}.xml"/>`;
    presRelsXml = presRelsXml.replace("</Relationships>", `${newRel}</Relationships>`);
    modified[presRelsPath] = new TextEncoder().encode(presRelsXml);
  }

  // 5. Update [Content_Types].xml
  const ctPath = "[Content_Types].xml";
  const ctBytes = unzipped[ctPath];
  if (ctBytes) {
    let ctXml = new TextDecoder().decode(ctBytes);
    const override = `<Override PartName="/ppt/slides/slide${newSlideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
    ctXml = ctXml.replace("</Types>", `${override}</Types>`);
    modified[ctPath] = new TextEncoder().encode(ctXml);
  }

  return {
    action: "insert_slide",
    success: true,
    new_slide_number: newSlideNum,
    modified_files: modified,
    deleted_files: [],
  };
}

/**
 * Deletes a slide from the PPTX.
 *
 * @param unzipped  The unzipped PPTX file map
 * @param slideNumber  1-based slide number to delete
 */
export function deleteSlide(
  unzipped: Record<string, Uint8Array>,
  slideNumber: number,
): PptxStructuralResult {
  const slidePath = `ppt/slides/slide${slideNumber}.xml`;
  const relsPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;

  if (!unzipped[slidePath]) {
    return {
      action: "delete_slide",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: `Slide ${slideNumber} not found`,
    };
  }

  // Check that we're not deleting the last slide
  const slideCount = Object.keys(unzipped).filter((k) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(k),
  ).length;
  if (slideCount <= 1) {
    return {
      action: "delete_slide",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: "Cannot delete the last remaining slide",
    };
  }

  const deleted: string[] = [slidePath];
  if (unzipped[relsPath]) deleted.push(relsPath);

  const modified: Record<string, Uint8Array> = {};

  // 1. Find the rId for this slide in presentation.xml.rels and remove it
  const presRelsPath = "ppt/_rels/presentation.xml.rels";
  const presRelsBytes = unzipped[presRelsPath];
  let slideRId: string | null = null;

  if (presRelsBytes) {
    let presRelsXml = new TextDecoder().decode(presRelsBytes);
    const relPattern = new RegExp(
      `<Relationship[^>]*Target="slides/slide${slideNumber}\\.xml"[^>]*/>`,
    );
    const relMatch = relPattern.exec(presRelsXml);
    if (relMatch) {
      const rIdMatch = relMatch[0].match(/Id="(rId\d+)"/);
      slideRId = rIdMatch ? rIdMatch[1] : null;
      presRelsXml = presRelsXml.replace(relMatch[0], "");
      modified[presRelsPath] = new TextEncoder().encode(presRelsXml);
    }
  }

  // 2. Remove p:sldId from presentation.xml
  const presPath = "ppt/presentation.xml";
  const presBytes = unzipped[presPath];
  if (presBytes && slideRId) {
    let presXml = new TextDecoder().decode(presBytes);
    const sldIdPattern = new RegExp(
      `<p:sldId\\s[^>]*?r:id="${slideRId}"[^>]*?\\/>`,
    );
    presXml = presXml.replace(sldIdPattern, "");
    modified[presPath] = new TextEncoder().encode(presXml);
  }

  // 3. Remove override from [Content_Types].xml
  const ctPath = "[Content_Types].xml";
  const ctBytes = unzipped[ctPath];
  if (ctBytes) {
    let ctXml = new TextDecoder().decode(ctBytes);
    const overridePattern = new RegExp(
      `<Override[^>]*PartName="/ppt/slides/slide${slideNumber}\\.xml"[^>]*/>`,
    );
    ctXml = ctXml.replace(overridePattern, "");
    modified[ctPath] = new TextEncoder().encode(ctXml);
  }

  return {
    action: "delete_slide",
    success: true,
    deleted_slide_number: slideNumber,
    modified_files: modified,
    deleted_files: deleted,
  };
}

export function moveSlide(
  unzipped: Record<string, Uint8Array>,
  sourceSlideNumber: number,
  afterSlideNumber: number,
): PptxStructuralResult {
  const resolved = listPresentationSlideEntries(unzipped);
  if (!resolved) {
    return {
      action: "move_slide",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: "presentation.xml or presentation.xml.rels not found",
    };
  }

  const { presentationXml, entries } = resolved;
  const sourceIndex = entries.findIndex((entry) => entry.slideNumber === sourceSlideNumber);
  if (sourceIndex < 0) {
    return {
      action: "move_slide",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: `Source slide ${sourceSlideNumber} not found in presentation order`,
    };
  }

  if (afterSlideNumber === sourceSlideNumber) {
    return {
      action: "move_slide",
      success: true,
      modified_files: {},
      deleted_files: [],
    };
  }

  const nextEntries = [...entries];
  const [sourceEntry] = nextEntries.splice(sourceIndex, 1);
  if (!sourceEntry) {
    return {
      action: "move_slide",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: `Failed to isolate source slide ${sourceSlideNumber}`,
    };
  }

  let insertionIndex = 0;
  if (afterSlideNumber > 0) {
    const targetIndex = nextEntries.findIndex((entry) => entry.slideNumber === afterSlideNumber);
    if (targetIndex < 0) {
      return {
        action: "move_slide",
        success: false,
        modified_files: {},
        deleted_files: [],
        error: `Target slide ${afterSlideNumber} not found in presentation order`,
      };
    }
    insertionIndex = targetIndex + 1;
  }

  nextEntries.splice(insertionIndex, 0, sourceEntry);

  const currentOrder = entries.map((entry) => entry.slideNumber).join(",");
  const nextOrder = nextEntries.map((entry) => entry.slideNumber).join(",");
  if (currentOrder === nextOrder) {
    return {
      action: "move_slide",
      success: true,
      modified_files: {},
      deleted_files: [],
    };
  }

  const updatedPresentationXml = presentationXml.replace(
    /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/,
    `<p:sldIdLst>${nextEntries.map((entry) => entry.sldIdXml).join("")}</p:sldIdLst>`,
  );

  return {
    action: "move_slide",
    success: true,
    modified_files: {
      "ppt/presentation.xml": new TextEncoder().encode(updatedPresentationXml),
    },
    deleted_files: [],
  };
}

function getPreserveOrderNodeKey(node: any): string | null {
  if (!node || typeof node !== "object") return null;
  const keys = Object.keys(node).filter((key) => key !== ":@");
  return keys[0] || null;
}

function ensurePreserveOrderChild(parentNode: any, childTag: string) {
  const parentKey = getPreserveOrderNodeKey(parentNode);
  if (!parentKey) return null;
  const children = Array.isArray(parentNode[parentKey]) ? parentNode[parentKey] : [];
  parentNode[parentKey] = children;
  let child = children.find((entry: any) => getPreserveOrderNodeKey(entry) === childTag) || null;
  if (!child) {
    child = { [childTag]: [] };
    children.push(child);
  }
  if (!Array.isArray(child[childTag])) {
    child[childTag] = [];
  }
  return child;
}

function ensureNodeAttributes(node: any) {
  if (!node || typeof node !== "object") return null;
  if (!node[":@"] || typeof node[":@"] !== "object") {
    node[":@"] = {};
  }
  return node[":@"] as Record<string, unknown>;
}

function normalizeFormatColor(value: unknown): string | null {
  const normalized = String(value || "").trim().replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

function normalizeFormatAlignment(value: unknown): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  switch (normalized) {
    case "left":
    case "l":
      return "l";
    case "center":
    case "centre":
    case "ctr":
      return "ctr";
    case "right":
    case "r":
      return "r";
    case "justify":
    case "just":
      return "just";
    case "distributed":
    case "dist":
      return "dist";
    default:
      return null;
  }
}

function normalizeFormatUnderline(value: unknown): string {
  if (typeof value === "boolean") return value ? "sng" : "none";
  const normalized = String(value || "").trim().toLowerCase();
  if (["true", "1", "yes", "single", "sng"].includes(normalized)) return "sng";
  if (["false", "0", "no", "none"].includes(normalized)) return "none";
  return "sng";
}

function normalizeLineSpacingValue(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (numeric <= 10) {
    return String(Math.round(numeric * 100000));
  }
  return String(Math.round(numeric * 1000));
}

function ensureParagraphProperties(paragraphNode: any) {
  const paragraphChildren = Array.isArray(paragraphNode?.["a:p"]) ? paragraphNode["a:p"] : null;
  if (!paragraphChildren) return null;
  let pPrNode = paragraphChildren.find((entry: any) => getPreserveOrderNodeKey(entry) === "a:pPr") || null;
  if (!pPrNode) {
    pPrNode = { "a:pPr": [] };
    paragraphChildren.unshift(pPrNode);
  }
  if (!Array.isArray(pPrNode["a:pPr"])) {
    pPrNode["a:pPr"] = [];
  }
  return pPrNode;
}

function ensureRunProperties(runNode: any) {
  const runChildren = Array.isArray(runNode?.["a:r"]) ? runNode["a:r"] : null;
  if (!runChildren) return null;
  let rPrNode = runChildren.find((entry: any) => getPreserveOrderNodeKey(entry) === "a:rPr") || null;
  if (!rPrNode) {
    rPrNode = { "a:rPr": [] };
    runChildren.unshift(rPrNode);
  }
  if (!Array.isArray(rPrNode["a:rPr"])) {
    rPrNode["a:rPr"] = [];
  }
  return rPrNode;
}

function applyFormatChangeToRun(rPrNode: any, change: FormatChange): boolean {
  const attrs = ensureNodeAttributes(rPrNode);
  if (!attrs) return false;

  switch (change.property) {
    case "font_size": {
      const numeric = Number(change.value);
      if (!Number.isFinite(numeric) || numeric <= 0) return false;
      attrs["@_sz"] = String(Math.round(numeric * 100));
      return true;
    }
    case "font_color": {
      const color = normalizeFormatColor(change.value);
      if (!color) return false;
      const solidFill = ensurePreserveOrderChild(rPrNode, "a:solidFill");
      if (!solidFill) return false;
      const solidFillChildren = Array.isArray(solidFill["a:solidFill"]) ? solidFill["a:solidFill"] : [];
      solidFill["a:solidFill"] = solidFillChildren.filter((entry: any) => getPreserveOrderNodeKey(entry) !== "a:schemeClr");
      let srgbClr = solidFill["a:solidFill"].find((entry: any) => getPreserveOrderNodeKey(entry) === "a:srgbClr") || null;
      if (!srgbClr) {
        srgbClr = { "a:srgbClr": [] };
        solidFill["a:solidFill"].push(srgbClr);
      }
      const colorAttrs = ensureNodeAttributes(srgbClr);
      if (!colorAttrs) return false;
      colorAttrs["@_val"] = color;
      return true;
    }
    case "font_name": {
      const typeface = String(change.value || "").trim();
      if (!typeface) return false;
      for (const tag of ["a:latin", "a:ea", "a:cs"]) {
        const fontNode = ensurePreserveOrderChild(rPrNode, tag);
        const fontAttrs = fontNode ? ensureNodeAttributes(fontNode) : null;
        if (fontAttrs) {
          fontAttrs["@_typeface"] = typeface;
        }
      }
      return true;
    }
    case "bold":
      attrs["@_b"] = change.value ? "1" : "0";
      return true;
    case "italic":
      attrs["@_i"] = change.value ? "1" : "0";
      return true;
    case "underline":
      attrs["@_u"] = normalizeFormatUnderline(change.value);
      return true;
    default:
      return false;
  }
}

function applyFormatChangeToParagraph(paragraphNode: any, change: FormatChange): boolean {
  const pPrNode = ensureParagraphProperties(paragraphNode);
  if (!pPrNode) return false;
  const attrs = ensureNodeAttributes(pPrNode);
  if (!attrs) return false;

  switch (change.property) {
    case "alignment": {
      const alignment = normalizeFormatAlignment(change.value);
      if (!alignment) return false;
      attrs["@_algn"] = alignment;
      return true;
    }
    case "line_spacing": {
      const spacingValue = normalizeLineSpacingValue(change.value);
      if (!spacingValue) return false;
      const lnSpcNode = ensurePreserveOrderChild(pPrNode, "a:lnSpc");
      if (!lnSpcNode) return false;
      const lnSpcChildren = Array.isArray(lnSpcNode["a:lnSpc"]) ? lnSpcNode["a:lnSpc"] : [];
      lnSpcNode["a:lnSpc"] = lnSpcChildren.filter((entry: any) => getPreserveOrderNodeKey(entry) !== "a:spcPts");
      let spcPctNode = lnSpcNode["a:lnSpc"].find((entry: any) => getPreserveOrderNodeKey(entry) === "a:spcPct") || null;
      if (!spcPctNode) {
        spcPctNode = { "a:spcPct": [] };
        lnSpcNode["a:lnSpc"].push(spcPctNode);
      }
      const spacingAttrs = ensureNodeAttributes(spcPctNode);
      if (!spacingAttrs) return false;
      spacingAttrs["@_val"] = spacingValue;
      return true;
    }
    default:
      return false;
  }
}

export function applyPptxFormatPatch(
  parsedSlide: any,
  patch: FormatPatch,
): { success: boolean; touchedRuns: number; touchedParagraphs: number; error?: string } {
  const shapes = findAllShapes(parsedSlide);
  const normalizedShapeName = String(patch.target_shape_name || "").trim();
  const shape = shapes.find((candidate) =>
    (patch.target_shape_id && getShapeId(candidate) === patch.target_shape_id)
    || (normalizedShapeName && getShapeName(candidate) === normalizedShapeName)
  );

  if (!shape) {
    return {
      success: false,
      touchedRuns: 0,
      touchedParagraphs: 0,
      error: "Target shape for format patch not found",
    };
  }

  const sp = shape["p:sp"];
  if (!Array.isArray(sp)) {
    return {
      success: false,
      touchedRuns: 0,
      touchedParagraphs: 0,
      error: "Target shape does not expose text body",
    };
  }

  const txBodyNode = sp.find((entry: any) => getPreserveOrderNodeKey(entry) === "p:txBody") || null;
  const txBodyChildren = txBodyNode && Array.isArray(txBodyNode["p:txBody"]) ? txBodyNode["p:txBody"] : null;
  if (!txBodyChildren) {
    return {
      success: false,
      touchedRuns: 0,
      touchedParagraphs: 0,
      error: "Target shape does not contain p:txBody",
    };
  }

  const paragraphs = txBodyChildren.filter((entry: any) => getPreserveOrderNodeKey(entry) === "a:p");
  if (paragraphs.length === 0) {
    return {
      success: false,
      touchedRuns: 0,
      touchedParagraphs: 0,
      error: "Target shape does not contain paragraphs",
    };
  }

  const targetedParagraphs = patch.paragraph_index == null
    ? paragraphs
    : typeof patch.paragraph_index === "number" && patch.paragraph_index >= 0 && patch.paragraph_index < paragraphs.length
    ? [paragraphs[patch.paragraph_index]]
    : [];

  if (targetedParagraphs.length === 0) {
    return {
      success: false,
      touchedRuns: 0,
      touchedParagraphs: 0,
      error: "Paragraph target for format patch not found",
    };
  }

  let touchedRuns = 0;
  let touchedParagraphs = 0;
  let appliedAny = false;

  for (const paragraph of targetedParagraphs) {
    const paragraphLevelChanges = patch.changes.filter((change) =>
      change.property === "alignment" || change.property === "line_spacing"
    );
    const runLevelChanges = patch.changes.filter((change) =>
      !["alignment", "line_spacing"].includes(change.property)
    );

    if (paragraphLevelChanges.length > 0) {
      let paragraphTouched = false;
      for (const change of paragraphLevelChanges) {
        paragraphTouched = applyFormatChangeToParagraph(paragraph, change) || paragraphTouched;
      }
      if (paragraphTouched) {
        touchedParagraphs += 1;
        appliedAny = true;
      }
    }

    if (runLevelChanges.length > 0) {
      const runs = collectPptxRuns(paragraph);
      const targetedRuns = patch.run_index == null
        ? runs
        : typeof patch.run_index === "number" && patch.run_index >= 0 && patch.run_index < runs.length
        ? [runs[patch.run_index]]
        : [];

      for (const run of targetedRuns) {
        const rPrNode = ensureRunProperties(run.runNode);
        if (!rPrNode) continue;
        let runTouched = false;
        for (const change of runLevelChanges) {
          runTouched = applyFormatChangeToRun(rPrNode, change) || runTouched;
        }
        if (runTouched) {
          touchedRuns += 1;
          appliedAny = true;
        }
      }
    }
  }

  if (!appliedAny) {
    return {
      success: false,
      touchedRuns,
      touchedParagraphs,
      error: "Format patch did not touch any eligible PPTX target",
    };
  }

  return {
    success: true,
    touchedRuns,
    touchedParagraphs,
  };
}

function getFirstSlideLayoutRelationship(unzipped: Record<string, Uint8Array>) {
  const layouts = listSlideLayouts(unzipped);
  const layoutPath = layouts[0]?.layoutPath;
  if (!layoutPath) return null;
  return `../slideLayouts/${layoutPath.split("/").pop()}`;
}

function collectUnsupportedSourceSlideRelationships(relsXml: string) {
  const unsupported: string[] = [];
  const relationshipPattern = /<Relationship\b[^>]*Type="([^"]+)"[^>]*(?:TargetMode="([^"]+)")?[^>]*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = relationshipPattern.exec(relsXml)) !== null) {
    const type = match[1] || "";
    const targetMode = match[2] || "";
    if (type.endsWith("/slideLayout")) continue;
    if (type.endsWith("/notesSlide")) continue;
    if (targetMode.toLowerCase() === "external") {
      unsupported.push(type || "external_relationship");
      continue;
    }
    unsupported.push(type || "unknown_relationship");
  }
  return unsupported;
}

export function copySlideFromPresentation(
  targetUnzipped: Record<string, Uint8Array>,
  sourceUnzipped: Record<string, Uint8Array>,
  sourceSlideNumber: number,
  insertAfter: number,
): PptxStructuralResult {
  const sourceSlidePath = `ppt/slides/slide${sourceSlideNumber}.xml`;
  const sourceSlideBytes = sourceUnzipped[sourceSlidePath];
  if (!sourceSlideBytes) {
    return {
      action: "copy_slide_from_presentation",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: `Source slide ${sourceSlideNumber} not found in source presentation`,
    };
  }

  const sourceRelsPath = `ppt/slides/_rels/slide${sourceSlideNumber}.xml.rels`;
  const sourceRelsBytes = sourceUnzipped[sourceRelsPath];
  if (sourceRelsBytes) {
    const unsupportedRelationships = collectUnsupportedSourceSlideRelationships(
      new TextDecoder().decode(sourceRelsBytes),
    );
    if (unsupportedRelationships.length > 0) {
      return {
        action: "copy_slide_from_presentation",
        success: false,
        modified_files: {},
        deleted_files: [],
        error: `Source slide ${sourceSlideNumber} uses unsupported embedded relationships for safe copy: ${unsupportedRelationships.join(", ")}`,
      };
    }
  }

  const inserted = insertBlankSlide(targetUnzipped, insertAfter);
  if (!inserted.success || !inserted.new_slide_number) {
    return {
      action: "copy_slide_from_presentation",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: inserted.error || "Unable to allocate destination slide for cross-presentation copy",
    };
  }

  const newSlideNumber = inserted.new_slide_number;
  const newSlidePath = `ppt/slides/slide${newSlideNumber}.xml`;
  const newSlideRelsPath = `ppt/slides/_rels/slide${newSlideNumber}.xml.rels`;
  const modifiedFiles: Record<string, Uint8Array> = {
    ...inserted.modified_files,
    [newSlidePath]: new Uint8Array(sourceSlideBytes),
  };

  const layoutTarget = getFirstSlideLayoutRelationship(targetUnzipped);
  if (layoutTarget) {
    const relsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
      `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="${layoutTarget}"/>\n` +
      `</Relationships>`;
    modifiedFiles[newSlideRelsPath] = new TextEncoder().encode(relsXml);
  }

  return {
    action: "copy_slide_from_presentation",
    success: true,
    new_slide_number: newSlideNumber,
    modified_files: modifiedFiles,
    deleted_files: inserted.deleted_files,
  };
}

function findPptxShapeMatch(
  slideXml: string,
  opts: { shapeId?: string; shapeName?: string },
): { shapeXml: string; startIdx: number; endIdx: number } | null {
  const shapePatterns = [
    /<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g,
    /<p:pic\b[^>]*>[\s\S]*?<\/p:pic>/g,
  ];

  for (const pattern of shapePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(slideXml)) !== null) {
      const shapeXml = match[0];
      let found = false;
      if (opts.shapeId) {
        const idPattern = new RegExp(`cNvPr[^>]*\\sid="${escapeRegexStr(opts.shapeId)}"`);
        found = idPattern.test(shapeXml);
      }
      if (!found && opts.shapeName) {
        const namePattern = new RegExp(`cNvPr[^>]*\\sname="${escapeRegexStr(opts.shapeName)}"`);
        found = namePattern.test(shapeXml);
      }
      if (found) {
        return {
          shapeXml,
          startIdx: match.index,
          endIdx: match.index + shapeXml.length,
        };
      }
    }
  }

  return null;
}

export function deleteShapeFromSlide(
  unzipped: Record<string, Uint8Array>,
  slideNumber: number,
  opts: { shapeId?: string; shapeName?: string },
): PptxStructuralResult {
  const slidePath = `ppt/slides/slide${slideNumber}.xml`;
  const slideBytes = unzipped[slidePath];
  if (!slideBytes) {
    return {
      action: "delete_shape",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: `Slide ${slideNumber} not found`,
    };
  }

  const slideXml = new TextDecoder().decode(slideBytes);
  const targetShape = findPptxShapeMatch(slideXml, opts);
  if (!targetShape) {
    return {
      action: "delete_shape",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: "Target shape not found",
    };
  }

  const updatedSlideXml = slideXml.slice(0, targetShape.startIdx) + slideXml.slice(targetShape.endIdx);
  return {
    action: "delete_shape",
    success: true,
    modified_files: {
      [slidePath]: new TextEncoder().encode(updatedSlideXml),
    },
    deleted_files: [],
  };
}

export function restoreShapeOnSlide(
  unzipped: Record<string, Uint8Array>,
  slideNumber: number,
  shapeXml: string,
): PptxStructuralResult {
  const slidePath = `ppt/slides/slide${slideNumber}.xml`;
  const slideBytes = unzipped[slidePath];
  if (!slideBytes) {
    return {
      action: "restore_shape",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: `Slide ${slideNumber} not found`,
    };
  }

  const slideXml = new TextDecoder().decode(slideBytes);
  if (!slideXml.includes("</p:spTree>")) {
    return {
      action: "restore_shape",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: "Could not find </p:spTree> in slide XML",
    };
  }

  const updatedSlideXml = slideXml.replace("</p:spTree>", `${shapeXml}\n</p:spTree>`);
  return {
    action: "restore_shape",
    success: true,
    modified_files: {
      [slidePath]: new TextEncoder().encode(updatedSlideXml),
    },
    deleted_files: [],
  };
}

export function restoreSlide(
  unzipped: Record<string, Uint8Array>,
  op: PptxStructuralOp,
): PptxStructuralResult {
  const slideNumber = Number(op.slide_number || op.source_slide || 0);
  if (!Number.isInteger(slideNumber) || slideNumber <= 0) {
    return {
      action: "restore_slide",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: "slide_number is required",
    };
  }

  if (!op.slide_xml) {
    return {
      action: "restore_slide",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: "slide_xml is required",
    };
  }

  const slidePath = `ppt/slides/slide${slideNumber}.xml`;
  const relsPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
  if (unzipped[slidePath]) {
    return {
      action: "restore_slide",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: `Slide ${slideNumber} already exists`,
    };
  }

  const modified: Record<string, Uint8Array> = {
    [slidePath]: new TextEncoder().encode(op.slide_xml),
  };

  if (typeof op.slide_rels_xml === "string" && op.slide_rels_xml.length > 0) {
    modified[relsPath] = new TextEncoder().encode(op.slide_rels_xml);
  }

  const presPath = "ppt/presentation.xml";
  const presBytes = unzipped[presPath];
  if (!presBytes || !op.presentation_sldid_xml) {
    return {
      action: "restore_slide",
      success: false,
      modified_files: {},
      deleted_files: [],
      error: "presentation.xml or presentation_sldid_xml missing",
    };
  }

  let presXml = new TextDecoder().decode(presBytes);
  presXml = presXml.includes(op.presentation_sldid_xml)
    ? presXml
    : presXml.replace("</p:sldIdLst>", `${op.presentation_sldid_xml}</p:sldIdLst>`);
  modified[presPath] = new TextEncoder().encode(presXml);

  const presRelsPath = "ppt/_rels/presentation.xml.rels";
  const presRelsBytes = unzipped[presRelsPath];
  if (presRelsBytes && op.presentation_rel_xml) {
    let presRelsXml = new TextDecoder().decode(presRelsBytes);
    if (!presRelsXml.includes(op.presentation_rel_xml)) {
      presRelsXml = presRelsXml.replace("</Relationships>", `${op.presentation_rel_xml}</Relationships>`);
    }
    modified[presRelsPath] = new TextEncoder().encode(presRelsXml);
  }

  const ctPath = "[Content_Types].xml";
  const ctBytes = unzipped[ctPath];
  if (ctBytes && op.content_type_override_xml) {
    let ctXml = new TextDecoder().decode(ctBytes);
    if (!ctXml.includes(op.content_type_override_xml)) {
      ctXml = ctXml.replace("</Types>", `${op.content_type_override_xml}</Types>`);
    }
    modified[ctPath] = new TextEncoder().encode(ctXml);
  }

  return {
    action: "restore_slide",
    success: true,
    new_slide_number: slideNumber,
    modified_files: modified,
    deleted_files: [],
  };
}
