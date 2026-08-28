// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli search — busca de conteúdo no PROJETO EM USO (cwd ou --path).
 * "mão local": roda offline, sem rede, sem JWT. Preferência de motor:
 *   1) ripgrep (rg) no PATH — respeita .gitignore, acha untracked, rápido.
 *   2) git grep -n — se for repo git (arquivos versionados).
 *   3) walk recursivo em JS (bounded) — fallback p/ diretório arbitrário sem git/rg.
 * Assim funciona tanto no repo do MZ quanto em qualquer projeto que o usuário abrir.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "out", "coverage", ".mz-tmp", ".cache", "vendor", ".turbo"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES_WALK = 20000;

function haveRg() {
  try { execFileSync("rg", ["--version"], { stdio: ["ignore", "ignore", "ignore"] }); return true; } catch { return false; }
}

function parseGrepLines(out, maxResults) {
  const res = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^(.*?):(\d+):(.*)$/); // path:line:text (paths relativos → sem drive-letter)
    if (!m) continue;
    res.push({ file: m[1].replace(/\\/g, "/"), line: Number(m[2]), text: m[3].slice(0, 400) });
    if (res.length >= maxResults) break;
  }
  return res;
}

function viaRg(query, { cwd, regex, maxResults }) {
  const args = ["--line-number", "--no-heading", "--color", "never", "--max-count", "50"];
  if (!regex) args.push("--fixed-strings");
  args.push("-e", query, ".");
  const out = execFileSync("rg", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return parseGrepLines(out, maxResults);
}

function viaGitGrep(query, { cwd, regex, maxResults }) {
  const args = ["grep", "-n", "-I", regex ? "-E" : "-F", "-e", query];
  const out = execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return parseGrepLines(out, maxResults);
}

function safeRegex(q) {
  try { return new RegExp(q, "i"); }
  catch { return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
}

function viaWalk(query, { cwd, regex, maxResults }) {
  const res = [];
  const rx = regex ? safeRegex(query) : null;
  const needle = regex ? null : query;
  const stack = [cwd];
  let scanned = 0;
  while (stack.length && res.length < maxResults && scanned < MAX_FILES_WALK) {
    const dir = stack.pop();
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(full); continue; }
      if (!e.isFile()) continue;
      scanned++;
      let st; try { st = statSync(full); } catch { continue; }
      if (st.size > MAX_FILE_BYTES) continue;
      let content; try { content = readFileSync(full, "utf8"); } catch { continue; }
      if (content.includes("\u0000")) continue; // binário
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const hit = rx ? rx.test(lines[i]) : lines[i].includes(needle);
        if (hit) {
          res.push({ file: path.relative(cwd, full).replace(/\\/g, "/"), line: i + 1, text: lines[i].slice(0, 400) });
          if (res.length >= maxResults) return res;
        }
      }
    }
  }
  return res;
}

/**
 * Busca `query` no projeto. Retorna {engine, matches:[{file,line,text}]}.
 * Nunca lança por "0 matches" (rg/git grep saem 1 quando não há match → tratado).
 */
export function searchProject(query, { cwd = process.cwd(), regex = true, maxResults = 100 } = {}) {
  const opts = { cwd, regex, maxResults };
  if (haveRg()) {
    try { return { engine: "ripgrep", matches: viaRg(query, opts) }; }
    catch (e) { if (e && e.status === 1) return { engine: "ripgrep", matches: [] }; }
  }
  let isGit = false;
  try { execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, stdio: ["ignore", "pipe", "ignore"] }); isGit = true; } catch { /* não é git */ }
  if (isGit) {
    try { return { engine: "git-grep", matches: viaGitGrep(query, opts) }; }
    catch (e) { if (e && e.status === 1) return { engine: "git-grep", matches: [] }; }
  }
  return { engine: "walk", matches: viaWalk(query, opts) };
}
