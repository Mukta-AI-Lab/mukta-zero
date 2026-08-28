// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview PPTX Parser — Análogo de docx-parser.ts para apresentações PowerPoint
 * @description Descompacta um arquivo PPTX, percorre ppt/slides/slideN.xml
 *              e extrai blocos estruturados por slide/shape/parágrafo.
 *
 * Importado por: process-document-reindex-job (branch pptx_snapshot)
 */

import { unzipSync } from "https://esm.sh/fflate@0.8.2";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.5.1";
import { computeContextHash } from "./ooxml-engine.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PptxRun {
  run_index: number;
  text: string;
  start_offset: number;    // offset acumulado dentro do parágrafo
  rPrNode: any | null;     // a:rPr para preservar formatação
}

export interface PptxParagraph {
  paragraph_index: number;
  runs: PptxRun[];
  full_text: string;
  context_hash: string;    // preenchido de forma síncrona (sem SHA nativo em parser)
}

export interface PptxShape {
  shape_id: string;        // cNvPr @id
  shape_name: string;      // cNvPr @name
  slide_number: number;
  paragraphs: PptxParagraph[];
}

export interface PptxBlock {
  /** Chave determinística: slide{N}_sp{shape_id}_p{paraIdx} */
  block_key: string;
  slide_number: number;
  shape_id: string;
  paragraph_index: number;
  text: string;
  /** SHA-256 de contexto — preenchido de forma assíncrona via computeContextHash */
  context_hash: string;
  xml_path: string;
  order_index: number;     // índice global para ordenação
}

// ─── XML Parser config ────────────────────────────────────────────────────────

function makePptxParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    trimValues: false,
    textNodeName: "#text",
  });
}

// ─── Shape helpers ────────────────────────────────────────────────────────────

function findAllShapesInSlide(node: any, results: any[] = []): any[] {
  if (!node || typeof node !== "object") return results;

  if (Array.isArray(node)) {
    for (const item of node) findAllShapesInSlide(item, results);
    return results;
  }

  const keys = Object.keys(node).filter((k) => k !== ":@");
  if (keys.length === 0) return results;
  const tagName = keys[0];

  if (tagName === "p:sp") {
    results.push(node);
  }

  const children = node[tagName];
  if (Array.isArray(children)) findAllShapesInSlide(children, results);

  return results;
}

function getShapeAttr(shape: any, attrName: string): string | null {
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
      if (nvKeys[0] === "p:cNvPr") {
        const attr = nvChild[":@"]?.[`@_${attrName}`];
        return attr != null ? String(attr) : null;
      }
    }
  }
  return null;
}

function getTxBodyParagraphs(shape: any): any[] {
  const sp = shape["p:sp"];
  if (!Array.isArray(sp)) return [];

  for (const child of sp) {
    if (!child || typeof child !== "object") continue;
    const keys = Object.keys(child).filter((k) => k !== ":@");
    if (keys[0] !== "p:txBody") continue;

    const txBody = child["p:txBody"];
    if (!Array.isArray(txBody)) continue;

    return txBody.filter((c: any) => {
      if (!c || typeof c !== "object") return false;
      const k = Object.keys(c).filter((key) => key !== ":@");
      return k[0] === "a:p";
    });
  }
  return [];
}

// ─── Run extraction ───────────────────────────────────────────────────────────

function extractRunsFromPptxParagraph(paragraphNode: any): PptxRun[] {
  const runs: PptxRun[] = [];
  const apChildren = paragraphNode["a:p"];
  if (!Array.isArray(apChildren)) return runs;

  let offset = 0;
  let runIndex = 0;

  for (const child of apChildren) {
    if (!child || typeof child !== "object") continue;
    const keys = Object.keys(child).filter((k) => k !== ":@");
    if (keys[0] !== "a:r") continue;

    const arChildren = child["a:r"];
    if (!Array.isArray(arChildren)) continue;

    let text = "";
    let rPrNode: any = null;

    for (const arChild of arChildren) {
      if (!arChild || typeof arChild !== "object") continue;
      const arKeys = Object.keys(arChild).filter((k) => k !== ":@");
      const tag = arKeys[0];

      if (tag === "a:rPr") {
        rPrNode = arChild;
        continue;
      }
      if (tag === "a:t") {
        const tContent = arChild["a:t"];
        if (typeof tContent === "string") {
          text += tContent;
        } else if (Array.isArray(tContent)) {
          for (const t of tContent) {
            if (typeof t === "string") text += t;
            else if (t && t["#text"] != null) text += String(t["#text"]);
          }
        } else if (tContent && tContent["#text"] != null) {
          text += String(tContent["#text"]);
        }
      }
    }

    runs.push({ run_index: runIndex, text, start_offset: offset, rPrNode });
    offset += text.length;
    runIndex++;
  }

  return runs;
}

// ─── Context hash sync approximation ─────────────────────────────────────────
// computeContextHash é assíncrono (SHA-256 via crypto.subtle).
// Para o parser síncrono, usamos uma versão simplificada baseada em djb2
// que é substituída pelo hash real na fase de sync quando possível.

function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // uint32
  }
  return hash.toString(16).padStart(8, "0");
}

function syncContextHash(before: string, target: string, after: string): string {
  const raw = `${before.slice(-50)}|${target}|${after.slice(0, 50)}`;
  return `djb2_${djb2Hash(raw)}`;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Descompacta um buffer PPTX e retorna um array de blocos estruturados.
 * Cada bloco corresponde a um parágrafo não-vazio de um shape de texto.
 *
 * @param buffer Uint8Array do arquivo PPTX
 * @returns Array de PptxBlock ordenados por slide + ordem de aparição
 */
export function parsePptxToBlocks(buffer: Uint8Array): PptxBlock[] {
  const unzipped = unzipSync(buffer);
  const parser = makePptxParser();

  // Encontra e ordena os slides
  const slideKeys = Object.keys(unzipped)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml$/i)?.[1] ?? "0", 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml$/i)?.[1] ?? "0", 10);
      return numA - numB;
    });

  const blocks: PptxBlock[] = [];
  let globalOrder = 0;

  for (const slideKey of slideKeys) {
    const slideNum = parseInt(slideKey.match(/slide(\d+)\.xml$/i)?.[1] ?? "0", 10);
    const slideXml = new TextDecoder().decode(unzipped[slideKey]);
    const parsedSlide = parser.parse(slideXml);

    const shapes = findAllShapesInSlide(parsedSlide);

    for (const shape of shapes) {
      const shapeId = getShapeAttr(shape, "id");
      if (!shapeId) continue;

      const paragraphNodes = getTxBodyParagraphs(shape);

      // Coletamos todos os textos dos parágrafos para context_hash
      const allTexts: string[] = paragraphNodes.map((pNode: any) => {
        const runs = extractRunsFromPptxParagraph(pNode);
        return runs.map((r) => r.text).join("");
      });

      for (let paraIdx = 0; paraIdx < paragraphNodes.length; paraIdx++) {
        const runs = extractRunsFromPptxParagraph(paragraphNodes[paraIdx]);
        const fullText = runs.map((r) => r.text).join("").trim();

        if (!fullText) continue; // ignora parágrafos vazios

        const before = allTexts[paraIdx - 1] ?? "";
        const after = allTexts[paraIdx + 1] ?? "";
        const contextHash = syncContextHash(before, fullText, after);

        const blockKey = `slide${slideNum}_sp${shapeId}_p${paraIdx}`;
        const xmlPath = `slides/slide${slideNum}/shapes/sp[${shapeId}]/paragraphs[${paraIdx}]`;

        blocks.push({
          block_key: blockKey,
          slide_number: slideNum,
          shape_id: shapeId,
          paragraph_index: paraIdx,
          text: fullText,
          context_hash: contextHash,
          xml_path: xmlPath,
          order_index: globalOrder++,
        });
      }
    }
  }

  return blocks;
}

/**
 * Versão assíncrona que recalcula context_hash com SHA-256 real (crypto.subtle).
 * Use esta versão quando possível para máxima precisão do hash.
 */
export async function parsePptxToBlocksAsync(buffer: Uint8Array): Promise<PptxBlock[]> {
  const blocks = parsePptxToBlocks(buffer);
  const enhanced: PptxBlock[] = [];

  // Agrupa por slide+shape para calcular contexto entre parágrafos
  const grouped = new Map<string, PptxBlock[]>();
  for (const block of blocks) {
    const key = `${block.slide_number}_${block.shape_id}`;
    const group = grouped.get(key) ?? [];
    group.push(block);
    grouped.set(key, group);
  }

  for (const [, group] of grouped) {
    const sorted = [...group].sort((a, b) => a.paragraph_index - b.paragraph_index);
    for (let i = 0; i < sorted.length; i++) {
      const block = sorted[i];
      const before = sorted[i - 1]?.text ?? "";
      const after = sorted[i + 1]?.text ?? "";
      const hash = await computeContextHash(before, block.text, after);
      enhanced.push({ ...block, context_hash: hash });
    }
  }

  return enhanced.sort((a, b) => a.order_index - b.order_index);
}

/**
 * Extrai texto plano de um PPTX para indexação RAG.
 * Retorna array de strings por slide, mantendo ordem visual.
 */
export function extractPptxTextBySlide(buffer: Uint8Array): { slide: number; text: string }[] {
  const blocks = parsePptxToBlocks(buffer);
  const bySlide = new Map<number, string[]>();

  for (const block of blocks) {
    const texts = bySlide.get(block.slide_number) ?? [];
    texts.push(block.text);
    bySlide.set(block.slide_number, texts);
  }

  const result: { slide: number; text: string }[] = [];
  for (const [slide, texts] of [...bySlide.entries()].sort((a, b) => a[0] - b[0])) {
    result.push({ slide, text: texts.join("\n") });
  }
  return result;
}
