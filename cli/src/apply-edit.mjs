// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli apply-edit — componente MODEL-AGNOSTIC (G2) para editar arquivos por
 * blocos SEARCH/REPLACE, fechando a ponte B. O unified-diff é frágil (o modelo tem que acertar
 * numeração de linha + reproduzir contexto letra-por-letra → "patch_apply_failed"). Aqui o modelo
 * só diz "ache ESTE trecho / troque por AQUELE" — nenhuma contagem — e um aplicador DETERMINÍSTICO
 * casa a string (exata → tolerante a espaço) e substitui. Reusado por mz patch, swebench-agentic, repo-tools.
 *
 * Formato do bloco (estilo Aider):
 *   caminho/opcional/do/arquivo.py
 *   <<<<<<< SEARCH
 *   <linhas exatas a achar>
 *   =======
 *   <linhas novas>
 *   >>>>>>> REPLACE
 */

const NL = (s) => String(s == null ? "" : s).replace(/\r\n/g, "\n");
const looksLikePath = (s) => !!s && (s.includes("/") || /\.[a-zA-Z0-9]{1,8}$/.test(s)) && !/\s{2,}/.test(s) && s.length < 200;

/** Parseia todos os blocos SEARCH/REPLACE de um texto. Retorna [{path|null, search, replace}]. */
export function parseEditBlocks(text) {
  const t = NL(text);
  const blocks = [];
  const re = /(^|\n)([^\n]*)\n<{5,}\s*SEARCH\s*\n([\s\S]*?)\n={5,}\s*\n([\s\S]*?)\n>{5,}\s*REPLACE/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const pathLine = (m[2] || "").trim().replace(/^`+|`+$/g, "").replace(/^#+\s*/, "");
    blocks.push({ path: looksLikePath(pathLine) ? pathLine : null, search: m[3], replace: m[4] });
  }
  return blocks;
}

/** Aplica UM par search/replace. Escada: exato → trailing-ws → indentação (por linha). */
export function applyOne(content, search, replace) {
  const c = NL(content), s = NL(search), r = NL(replace);
  if (s.trim() === "") return { ok: true, content: r }; // arquivo novo (SEARCH vazio)
  // 1) exato
  const idx = c.indexOf(s);
  if (idx !== -1) return { ok: true, content: c.slice(0, idx) + r + c.slice(idx + s.length) };
  // 2) tolerante a trailing whitespace
  const strip = (x) => x.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n");
  const cn = strip(c), sn = strip(s), ni = cn.indexOf(sn);
  if (ni !== -1) return { ok: true, content: cn.slice(0, ni) + r + cn.slice(ni + sn.length), fuzzy: "trailing" };
  // 3) G4b: tolerante a INDENTAÇÃO — casa por linha ignorando leading+trailing whitespace (fecha search-not-found
  //    quando o modelo acerta o conteúdo mas erra a indentação exata do trecho copiado).
  const cL = c.split("\n"), sL = s.split("\n"), sT = sL.map((x) => x.trim());
  for (let i = 0; i + sL.length <= cL.length; i++) {
    let ok = true;
    for (let jj = 0; jj < sL.length; jj++) { if (cL[i + jj].trim() !== sT[jj]) { ok = false; break; } }
    if (ok) return { ok: true, content: [...cL.slice(0, i), ...r.split("\n"), ...cL.slice(i + sL.length)].join("\n"), fuzzy: "indent" };
  }
  return { ok: false, reason: "trecho SEARCH não encontrado no arquivo (contexto não bate)" };
}

/**
 * Aplica blocos a UM conteúdo de arquivo (single-file, ex.: mz patch). Cada bloco cujo `path` seja
 * diferente de `targetPath` (quando informado) é REJEITADO (guarda de escopo — o editor não pode
 * tocar outro arquivo). Aplica em sequência; falha o conjunto se qualquer bloco não casar.
 * @returns {{ ok:boolean, content?:string, applied:number, error?:string }}
 */
export function applyBlocksToContent(content, blocks, targetPath = null) {
  if (!blocks.length) return { ok: false, applied: 0, error: "nenhum bloco SEARCH/REPLACE reconhecido" };
  let cur = NL(content), applied = 0;
  for (const b of blocks) {
    if (targetPath && b.path && b.path !== targetPath) return { ok: false, applied, error: `bloco fora do alvo '${targetPath}': ${b.path}` };
    const r = applyOne(cur, b.search, b.replace);
    if (!r.ok) return { ok: false, applied, error: `bloco #${applied + 1}: ${r.reason}` };
    cur = r.content; applied++;
  }
  return { ok: true, content: cur, applied };
}
