// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli codegen-output — componente MODEL-AGNOSTIC (G1) para o "empacotamento" da saída
 * de codegen. Fecha a ponte A: o cérebro RESOLVE, mas a solução se perdia na serialização JSON/truncagem
 * ("no-json"). Este módulo torna o TRANSPORTE robusto para QUALQUER modelo:
 *  - CONTRATO de saída em bloco cercado (```lang) — não força json_mode (que trunca em solução longa).
 *  - EXTRATOR tolerante: JSON {code} → bloco cercado ```lang → programa cru heurístico.
 * Doutrina: a confiabilidade vive no extrator determinístico, não no prompt (cada modelo quebra o JSON
 * de um jeito). Reusado pelo build.mjs (produção) e espelhado nos harnesses de benchmark.
 */

/** Instrução de saída reusável — pede um único bloco de código cercado, sem JSON, sem prosa. */
export function codegenOutputContract(langLabel = "código") {
  return [
    `Responda com UM ÚNICO bloco de ${langLabel} cercado por três crases, assim:`,
    "```",
    "<arquivo completo>",
    "```",
    "Nada antes ou depois do bloco. NÃO use JSON. NÃO omita trechos (sem \"...\", sem TODO no lugar de implementação).",
  ].join("\n");
}

/** Tenta JSON tolerante (fence ```json, prosa ao redor, primeiro {...}). */
function tolerantJson(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch { /* */ }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch { /* */ } }
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s !== -1 && e !== -1 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch { /* */ } }
  return null;
}

/**
 * extractCode — extração ROBUSTA do código a partir da resposta crua do modelo.
 * Ordem: (1) JSON {code}; (2) bloco cercado ```lang…```; (3) programa cru heurístico.
 * Elimina o modo de falha 'no-json'/truncagem: se o JSON quebrou, o código quase sempre ainda está
 * recuperável do bloco cercado ou do texto cru. Retorna string ou null.
 */
/**
 * Sinais de que um trecho é CÓDIGO e não prosa. A lista anterior tinha 15
 * construções e reprovava um arquivo Python que começasse por docstring, um
 * `@decorator`, um `async def`, um `match`, ou um módulo só de `lambda`/tipos.
 * Medido pelo MZ-Front (FB12): ~17% dos builds morriam AQUI, e a mensagem
 * culpava o modelo — o que leva a trocar de modelo, que não conserta extrator.
 */
const SINAIS_DE_CODIGO = new RegExp(
  [
    // Python
    "^\\s*(def|class|import|from|async def|@\\w+|if __name__|with |try:|match |lambda |return |raise |assert |yield )",
    "print\\(", "sys\\.(stdin|argv)", "->\\s*(int|str|float|bool|list|dict|None)", "\"\"\"", "'''",
    // JS/TS
    "\\b(function|const|let|var|export|require\\(|module\\.exports|=>)\\b", "console\\.",
    // C/C++/Java/Go/Rust e afins
    "#include", "\\bpackage \\w+", "\\bfn \\w+\\(", "\\bpublic (static |class )", "\\bstruct \\w+",
    // estrutura genérica de programa
    "^\\s*(for|while|if|switch)\\s*[\\(:]", "[;{}]\\s*$",
  ].join("|"),
  "m",
);

const pareceCodigo = (s) => SINAIS_DE_CODIGO.test(String(s || ""));

/**
 * Blocos cercados do texto — cobre as formas que a versão anterior perdia:
 *  · cerca com ``` OU ~~~, com 3 ou mais marcadores
 *  · cerca com indentação (dentro de lista/citação)
 *  · **cerca NÃO FECHADA** — saída truncada no teto de tokens é justamente o
 *    caso em que o código está lá inteiro e o fecho não chegou. Falhar aqui é
 *    jogar fora um resultado que existe.
 */
function blocosCercados(t) {
  const out = [];
  // O fecho é a cerca correspondente OU o fim REAL da entrada `(?![\s\S])`.
  // Não `$`: com a flag `m`, `$` casa fim de LINHA, então o corpo terminava na
  // primeira quebra e o bloco vinha com uma linha só — o que fazia um arquivo
  // que abre por docstring ou `@decorator` ser extraído como essa linha isolada.
  const re = /^[ \t]*(`{3,}|~{3,})[ \t]*([a-zA-Z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)(?:^[ \t]*\1[ \t]*$|(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(t)) !== null) {
    const corpo = m[3];
    if (corpo && corpo.trim()) out.push({ lang: m[2] || "", corpo: corpo.replace(/\r?\n?[ \t]*(`{3,}|~{3,})[ \t]*$/, "") });
  }
  return out;
}

/**
 * extractCode — extração ROBUSTA do código a partir da resposta crua do modelo.
 *
 * Ordem: (1) JSON com o código em alguma chave conhecida; (2) blocos cercados,
 * escolhendo o MAIOR que pareça código (e não o primeiro — modelos abrem com um
 * bloco de exemplo curto antes do arquivo real); (3) o texto cru, se parecer um
 * programa, com a prosa de abertura descartada.
 *
 * Retorna string ou null. Quem chama DEVE guardar a saída crua quando isto der
 * null — sem ela, a próxima falha é indistinguível desta.
 */
export function extractCode(raw) {
  const t = String(raw || "");
  if (!t.trim()) return null;

  // 1) JSON — `code` é o contrato, mas modelos usam outras chaves com o mesmo papel.
  const j = tolerantJson(t);
  if (j) {
    for (const k of ["code", "content", "source", "file", "arquivo", "programa", "solution"]) {
      if (typeof j[k] === "string" && j[k].trim()) return j[k];
    }
  }

  // 2) blocos cercados — o MAIOR que pareça código.
  const blocos = blocosCercados(t).filter((b) => pareceCodigo(b.corpo));
  if (blocos.length) {
    return blocos.reduce((a, b) => (b.corpo.length > a.corpo.length ? b : a)).corpo.trim();
  }

  // 3) texto cru. Descarta a PROSA de abertura: o modelo explica antes de
  //    codificar, e incluir o parágrafo faz o arquivo não compilar — que
  //    depois é lido como "o modelo errou".
  const linhas = t.replace(/^[ \t]*(`{3,}|~{3,})[a-zA-Z0-9_+-]*[ \t]*\r?\n?/gm, "").split(/\r?\n/);
  const inicio = linhas.findIndex((l) => l.trim() && pareceCodigo(l));
  if (inicio !== -1) {
    const corpo = linhas.slice(inicio).join("\n").trim();
    if (corpo && pareceCodigo(corpo)) return corpo;
  }
  return null;
}
