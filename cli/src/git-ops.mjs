// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview Mukta Zero — git-ops (eixo 2: levar arquivos p/ git na nuvem e editar lá).
 * Camada de git de ESCRITA (add/commit/push/branch/PR) que faltava no mz-cli — antes só havia
 * git LOCAL read-only-ish (checkout/grep no agent.mjs). Fail-closed: valida branch, NUNCA --force,
 * NUNCA push direto na branch protegida sem --allow-default. PR opcional via `gh` CLI (se instalado).
 *
 * Autorado pelo supervisor (usa node:child_process → o cyber-gate do MZ bloquearia o mz build).
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_PROTECTED = new Set(["main", "master"]);

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Aplica um unified diff via `git apply` — FAIL-CLOSED: roda `--check` antes de aplicar de fato.
 * Não faz commit (o caller decide commitar via pushChanges). Escreve o diff num arquivo temp
 * (git apply de arquivo é mais robusto que stdin no execFileSync cross-platform). Lança com o
 * stderr real do git em caso de conflito/contexto que não bate (para o self-repair do patchLoop).
 * @returns {{applied:true}}
 */
/** Lista os caminhos que um diff (arquivo tmp) tocaria, via `git apply --numstat` (NÃO aplica). */
function diffTargets(tmpPath, cwd) {
  let out = "";
  try { out = git(["apply", "--numstat", "--recount", tmpPath], cwd); } catch { return []; }
  return out
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => {
      const parts = l.split("\t"); // "<add>\t<del>\t<path>"
      return parts.length >= 3 ? parts.slice(2).join("\t").replace(/^"|"$/g, "") : null;
    })
    .filter(Boolean);
}

export function applyPatch({ cwd = process.cwd(), diff, check = true, expectPath = null }) {
  if (!isGitRepo(cwd)) throw new Error("não é um repositório git");
  if (typeof diff !== "string" || !diff.trim()) throw new Error("diff vazio");
  const tmp = join(tmpdir(), `mz-patch-${process.pid}-${Math.floor(Date.now())}.diff`);
  writeFileSync(tmp, diff.endsWith("\n") ? diff : `${diff}\n`, "utf8");
  // --recount: NÃO confia nas contagens dos @@ (o erro mais comum de diff gerado por LLM — "corrupt
  // patch"); infere-as inspecionando o patch. Corta a maioria das falhas sem gastar rodada de self-repair.
  const flags = ["--recount", "--whitespace=nowarn"];
  try {
    // GUARDA DE ESCOPO (fail-closed): `git apply` aplica TODOS os hunks do diff — inclusive p/ OUTROS
    // arquivos e novos (via /dev/null). Como o cyber-gate do patchLoop só revisa/reverte o ALVO, um diff
    // que toca outro arquivo BURLARIA o gate. Enumera os paths ANTES de aplicar e rejeita fora do alvo.
    if (expectPath) {
      const touched = diffTargets(tmp, cwd);
      if (!touched.length) throw new Error("diff não toca nenhum arquivo reconhecível (ou é inválido)");
      const outside = touched.filter((p) => p !== expectPath);
      if (outside.length) throw new Error(`diff toca arquivo(s) fora do alvo '${expectPath}': ${outside.join(", ")}`);
    }
    if (check) git(["apply", "--check", ...flags, tmp], cwd); // fail-closed: não aplica se não bate
    git(["apply", ...flags, tmp], cwd);
    return { applied: true };
  } finally {
    try { unlinkSync(tmp); } catch { /* */ }
  }
}

/** Nome de branch seguro (sem espaços, sem '..', sem flags). */
export function validBranchName(name) {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(name) && !name.includes("..");
}

export function isGitRepo(cwd = process.cwd()) {
  try { return git(["rev-parse", "--is-inside-work-tree"], cwd) === "true"; } catch { return false; }
}
export function currentBranch(cwd = process.cwd()) { return git(["rev-parse", "--abbrev-ref", "HEAD"], cwd); }
export function isClean(cwd = process.cwd()) { return git(["status", "--porcelain"], cwd) === ""; }
export function hasRemote(remote = "origin", cwd = process.cwd()) {
  try { return git(["remote"], cwd).split(/\s+/).includes(remote); } catch { return false; }
}

/**
 * Commita as mudanças (escopadas a `files` se passado, senão tudo) numa BRANCH e pusha ao remoto.
 * Cria/switch a branch (checkout -B). NUNCA --force. Recusa branch protegida sem allowDefault.
 * @returns {{branch, remote, committed:boolean, pushed:boolean, sha:string}}
 */
export function pushChanges({ cwd = process.cwd(), branch, message, files = null, remote = "origin", allowDefault = false, doPush = true }) {
  if (!isGitRepo(cwd)) throw new Error("não é um repositório git");
  if (!validBranchName(branch)) throw new Error(`branch inválida: ${branch}`);
  if (DEFAULT_PROTECTED.has(branch) && !allowDefault) throw new Error(`recusado: '${branch}' é protegida (use --allow-default p/ forçar)`);
  if (!message || !message.trim()) throw new Error("mensagem de commit obrigatória");

  git(["checkout", "-B", branch], cwd);
  if (Array.isArray(files) && files.length) git(["add", "--", ...files], cwd);
  else git(["add", "-A"], cwd);

  // nada staged? aborta sem commit vazio.
  const staged = git(["diff", "--cached", "--name-only"], cwd);
  if (!staged) return { branch, remote, committed: false, pushed: false, sha: currentBranch(cwd) };

  git(["commit", "-m", message], cwd);
  const sha = git(["rev-parse", "HEAD"], cwd);

  let pushed = false;
  if (doPush) {
    if (!hasRemote(remote, cwd)) throw new Error(`remoto '${remote}' não configurado`);
    git(["push", "-u", remote, branch], cwd); // NUNCA --force
    pushed = true;
  }
  return { branch, remote, committed: true, pushed, sha };
}

/** Abre um PR via `gh` CLI (se disponível). Retorna a URL ou lança. OUTWARD-facing. */
export function openPr({ cwd = process.cwd(), branch, base = "main", title, body = "" }) {
  if (!validBranchName(branch)) throw new Error(`branch inválida: ${branch}`);
  try { git(["--version"], cwd); } catch { /* */ }
  try {
    const url = execFileSync("gh", ["pr", "create", "--head", branch, "--base", base, "--title", title || branch, "--body", body], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return url;
  } catch (e) {
    throw new Error(`falha ao abrir PR (gh CLI): ${String(e.message || e).slice(0, 200)}`);
  }
}
