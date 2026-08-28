// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli agent — agentic self-edit loop that edits the LOCAL
 * repo under the USER's own JWT (never service-role). Ports the loop shape
 * proven by scripts/agent/mz-selfedit.cjs (localize -> whole-file rewrite ->
 * fail-closed gate -> apply -> test -> iterate) from the bench driver
 * (service-role + bench-llm-dispatch) into the user-facing app
 * (user JWT + run-agent-chat via askAgent()).
 *
 * SECURITY (hard rules):
 *  - generateEdits() only ever calls askAgent() (src/api.mjs — user JWT via
 *    run-agent-chat). NEVER bench-llm-dispatch, NEVER a service-role key,
 *    NEVER X-Internal-Call. The caller supplies a live authContext (from
 *    src/auth.mjs restoreClient()/createAuthedClient()) exactly like `mz ask`.
 *  - The cyber-gate (localReview(), src/review.mjs — the same offline,
 *    deterministic "mao local" signature gate `mz review` uses) runs on
 *    EVERY generated file's content BEFORE a single byte is written to disk.
 *    If ANY file in a round is blocked, NOTHING in that round is written
 *    (all-or-nothing) and the round aborts with feedback fed into the next
 *    generation attempt.
 *  - Each round starts with `git checkout -- <files>` — resets ONLY the
 *    declared target files. NEVER `git reset --hard` (would blow away other
 *    uncommitted work in the tree).
 *  - Scope is the explicit `files` list (given by the caller, or resolved by
 *    localize()). Any generated path that is not byte-for-byte in that list
 *    is rejected before the gate even runs. Paths outside the repo
 *    (absolute, drive-letter, `..` traversal) are rejected up front.
 */

import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { askAgent, extractResponseText } from "./api.mjs";
import { extractJson, localReview } from "./review.mjs";
import { assembleSystem } from "./persona.mjs";

const EDITOR_PERSONA = [
  "Voce edita o PROPRIO repositorio do usuario (self-edit), como um",
  "engenheiro de software senior.",
  "",
  "Dada a TAREFA + o conteudo ATUAL de um ou mais arquivos (e, se houver, o",
  "FEEDBACK de uma rodada anterior que falhou), reescreva o CONTEUDO COMPLETO",
  "de cada arquivo que precisa mudar (arquivo inteiro, nao um diff/patch).",
  "Preserve TODO o resto do arquivo intacto; altere ou adicione somente o",
  "necessario para cumprir a tarefa.",
  "",
  "Responda EXCLUSIVAMENTE com um objeto JSON valido, sem markdown, sem texto",
  "antes ou depois, no formato exato:",
  '{"files":[{"path":"<caminho exato, identico ao informado em ARQUIVOS ATUAIS>","content":"<conteudo COMPLETO do novo arquivo>"}]}',
  "",
  "Regras:",
  "- So edite arquivos que estao na lista de ARQUIVOS ATUAIS informada. Nao",
  "  invente nem renomeie caminhos.",
  '- Nao inclua nada fora do objeto JSON (nem cercas de markdown ```).',
  "- Se houver FEEDBACK de uma rodada anterior (falha de teste, bloqueio de",
  "  seguranca do cyber-gate, ou erro de sintaxe), corrija a causa raiz",
  "  indicada, nao apenas o sintoma. Nao repita o mesmo erro.",
].join("\n");

const MAX_LOCALIZE_FILES = 3;
const TEST_TIMEOUT_MS = 60_000;

// Stopwords (PT + EN) filtered out of the task text before it is used as
// git-grep keywords in localize() — keeps the search on domain nouns instead
// of connective/instruction words that would return noise.
const STOPWORDS = new Set(
  [
    "para", "com", "que", "uma", "um", "dos", "das", "dele", "dela", "esta",
    "este", "isso", "aquele", "onde", "quando", "como", "pelo", "pela",
    "pelos", "pelas", "pode", "deve", "deveria", "deveriam", "pois", "mas",
    "seu", "sua", "seus", "suas", "nao", "sim", "tambem", "entao", "assim",
    "cada", "todo", "toda", "todos", "todas", "corrija", "corrigir",
    "adicione", "adicionar", "implemente", "implementar", "crie", "criar",
    "edite", "editar", "arquivo", "arquivos", "codigo", "funcao", "função",
    "the", "and", "that", "this", "with", "from", "function", "file",
    "files", "code", "edit", "editing", "fix", "add", "adding",
    "implement", "create", "creating", "should", "would", "there", "their",
  ].map((w) => w.toLowerCase())
);

/** Extracts up to `max` distinct, non-stopword keywords (>=4 chars) from a free-text task description. */
export function extractKeywords(task, max = 3) {
  const words = String(task || "").toLowerCase().match(/[a-z0-9_]{4,}/g) || [];
  const out = [];
  const seen = new Set();
  for (const word of words) {
    if (STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= max) break;
  }
  return out;
}

function gitGrepFiles(keyword, { cwd, scopeDir }) {
  const args = ["grep", "-l", "-i", "-F", keyword];
  if (scopeDir) args.push("--", scopeDir);
  try {
    const out = execFileSync("git", args, { cwd, encoding: "utf8" });
    return out.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    // git grep exits 1 when there are zero matches — not a real error.
    return [];
  }
}

/**
 * localize — best-effort file discovery when the caller didn't pass
 * `--file` explicitly. Extracts 2-3 keywords from the task text and runs
 * `git grep -l` for each (first scoped to `scopeDir`, e.g. "mz-cli", then
 * falling back to the whole repo if the scoped search found nothing).
 * Returns up to `maxFiles` distinct candidate paths, or [] if nothing (or
 * no usable keywords) was found — callers must handle the empty case.
 */
export function localize(task, { cwd = process.cwd(), scopeDir = undefined, maxFiles = MAX_LOCALIZE_FILES } = {}) {
  const keywords = extractKeywords(task, 3);
  if (!keywords.length) return [];

  const collect = (opts) => {
    const found = [];
    const seen = new Set();
    for (const keyword of keywords) {
      for (const file of gitGrepFiles(keyword, opts)) {
        if (!seen.has(file)) {
          seen.add(file);
          found.push(file);
          if (found.length >= maxFiles) return found;
        }
      }
    }
    return found;
  };

  const effScope = scopeDir !== undefined ? scopeDir : (existsSync(path.join(cwd, "mz-cli")) ? "mz-cli" : null);
  const scoped = collect({ cwd, scopeDir: effScope });
  if (scoped.length) return scoped;

  // Fall back to a repo-wide search ("ou do repo") before giving up.
  return collect({ cwd, scopeDir: null });
}

/** Rejects absolute paths, drive letters, and `..` traversal — repo-relative paths only. */
function isPathInScope(relPath) {
  const normalized = String(relPath || "").replace(/\\/g, "/");
  if (!normalized) return false;
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return false;
  return !normalized.split("/").some((segment) => segment === "..");
}

function buildFilesBlock(files, cwd) {
  return files
    .map((file) => {
      let content;
      try {
        content = readFileSync(path.join(cwd, file), "utf8");
      } catch {
        content = "(arquivo inexistente — sera criado)";
      }
      return `### ${file}\n\`\`\`\n${content}\n\`\`\``;
    })
    .join("\n\n");
}

/**
 * generateEdits — ONE call to askAgent() (user JWT, run-agent-chat) with the
 * EDITOR_PERSONA system_prompt_override. Sends the task + current content of
 * every target file (+ prior-round feedback, if any) and parses the model's
 * {"files":[{"path","content"}]} JSON reply.
 */
export async function generateEdits(authContext, { task, files, feedback = "", agentId, companyId, cwd = process.cwd() }) {
  const messageLines = [`TAREFA: ${task}`, "", "ARQUIVOS ATUAIS:", buildFilesBlock(files, cwd)];

  if (feedback) {
    messageLines.push("", "── FEEDBACK da rodada anterior ──", feedback);
  }
  messageLines.push("", "Reescreva o(s) arquivo(s) que mudam (conteudo COMPLETO de cada um).");

  const result = await askAgent(authContext, {
    prompt: messageLines.join("\n"),
    agentId,
    companyId,
    // Ground-zero do MZ + customização local do usuário (~/.mukta + .mukta) com a
    // persona de TAREFA (editor) anexada por último — a MESMA identidade que `mz ask`,
    // consistente em todo o MZ (it.31). Sem isto, o editor herdaria a persona da company.
    systemPromptOverride: assembleSystem({ cwd, extraOverride: EDITOR_PERSONA }),
  });

  if (!result.ok) {
    const message =
      (result.payload && result.payload.error && (result.payload.error.message || result.payload.error)) ||
      (result.rawText ? result.rawText.slice(0, 300) : `HTTP ${result.status}`);
    return { ok: false, error: `Request failed (HTTP ${result.status}): ${message}`, edits: [], rawText: result.rawText || "" };
  }

  const responseText = extractResponseText(result);
  const parsed = extractJson(responseText);
  const edits =
    parsed && Array.isArray(parsed.files)
      ? parsed.files.filter((entry) => entry && typeof entry.path === "string" && entry.path.length > 0 && typeof entry.content === "string")
      : [];

  if (!edits.length) {
    return {
      ok: false,
      error: "O modelo nao retornou JSON valido com {files:[{path,content}]} nao-vazio.",
      edits: [],
      rawText: responseText,
    };
  }

  return { ok: true, error: null, edits, rawText: responseText };
}

/** Syntax gate (js/mjs/cjs only, matching scripts/agent/mz-selfedit.cjs's syntaxOk) — writes to an isolated temp dir, `node --check`s it, always cleans up. */
function syntaxCheck(filename, content) {
  if (!/\.(mjs|cjs|js)$/i.test(filename)) return { ok: true };

  const dir = mkdtempSync(path.join(os.tmpdir(), "mz-agent-check-"));
  try {
    const tmpFile = path.join(dir, `check${path.extname(filename)}`);
    writeFileSync(tmpFile, content, "utf8");
    execFileSync(process.execPath, ["--check", tmpFile], { stdio: ["ignore", "ignore", "pipe"] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.stderr || err.message || "").slice(0, 400) };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

/** Resets ONLY the declared target files to their last committed/staged state. NEVER `git reset --hard`. */
function resetFiles(files, cwd) {
  for (const file of files) {
    try {
      execFileSync("git", ["checkout", "--", file], { cwd, stdio: ["ignore", "ignore", "pipe"] });
    } catch {
      // A brand-new (never committed/staged) file has nothing to reset to —
      // harmless: the on-disk content (or absence) stands as-is.
    }
  }
}

function truncate(text, max = 4000) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}\n...[truncado]` : text;
}

/** Runs the caller-supplied test command (a real oracle, e.g. `node test.mjs` / `pytest -q`) with a timeout and a stripped-noise error message. */
function runTestCmd(testCmd, cwd) {
  try {
    const out = execSync(testCmd, { cwd, timeout: TEST_TIMEOUT_MS, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { pass: true, output: truncate(String(out)) };
  } catch (err) {
    const output = truncate(`${err.stdout || ""}\n${err.stderr || err.message || ""}`.trim());
    return { pass: false, output };
  }
}

/**
 * agentLoop — the capstone: reset -> generateEdits -> [scope gate] ->
 * [cyber-gate, HARD] -> [syntax gate] -> apply -> [test -> repair]*.
 *
 * Ordering is a hard rule: the cyber-gate (localReview) runs on every
 * generated file, for every round, BEFORE a single byte is written to disk.
 * A block never applies anything from that round — it feeds the finding back
 * as feedback and lets the model try again next round (still capped at
 * `maxRounds`), the same "gate rejects, feed the reason back" pattern
 * scripts/agent/mz-selfedit.cjs uses for its syntax gate.
 *
 * @param {object} authContext - live session (see src/auth.mjs restoreClient()/createAuthedClient()).
 * @param {object} opts
 * @param {string} opts.task - the edit task, in natural language.
 * @param {string[]} opts.files - repo-relative target file paths (explicit, or from localize()).
 * @param {string|null} [opts.testCmd] - real oracle command (e.g. "node test.mjs"); omit to skip test verification.
 * @param {number} [opts.maxRounds=3]
 * @param {string} opts.agentId
 * @param {string} opts.companyId
 * @param {string} [opts.cwd] - repo root; defaults to process.cwd().
 * @returns {Promise<{
 *   applied: boolean, passed: boolean|null, rounds: number,
 *   files: string[], cyber_blocked: boolean, log: object[], testOutput: string,
 * }>}
 */
export async function agentLoop(authContext, { task, files, testCmd = null, maxRounds = 3, agentId, companyId, cwd = process.cwd() }) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("agentLoop requires a non-empty `files` list (pass --file, or resolve via localize()).");
  }
  for (const file of files) {
    if (!isPathInScope(file)) {
      throw new Error(`Arquivo fora do escopo permitido (caminho absoluto ou com '..'): ${file}`);
    }
  }

  let feedback = "";
  let applied = false;
  let passed = null;
  let cyberBlocked = false;
  let appliedFiles = [];
  let lastTestOutput = "";
  let roundsAttempted = 0;
  const log = [];

  for (let round = 1; round <= maxRounds; round += 1) {
    roundsAttempted = round;
    resetFiles(files, cwd);

    const gen = await generateEdits(authContext, { task, files, feedback, agentId, companyId, cwd });
    if (!gen.ok) {
      feedback = gen.error;
      log.push({ round, stage: "generate", ok: false, detail: feedback });
      continue;
    }

    const outOfScope = gen.edits.find((edit) => !files.includes(edit.path));
    if (outOfScope) {
      feedback = `arquivo fora do escopo declarado: ${outOfScope.path}. Edite apenas: ${files.join(", ")}`;
      log.push({ round, stage: "scope", ok: false, detail: feedback });
      continue;
    }

    // HARD GATE — cyber-defense, before ANY byte is written to disk.
    // All edits in the round are checked; any block aborts the WHOLE round
    // (atomic — never a partial, half-reviewed apply).
    const blocked = gen.edits
      .map((edit) => ({ edit, report: localReview(edit.content, edit.path) }))
      .find(({ report }) => report.blocked);

    if (blocked) {
      cyberBlocked = true;
      const worst = blocked.report.findings.find((f) => f.severity === "block") || blocked.report.findings[0];
      const findingDesc = worst ? `[${worst.severity}] ${worst.cwe || worst.rule}: ${worst.message}` : blocked.report.summary;
      feedback = `cyber-gate bloqueou: ${blocked.edit.path} — ${findingDesc}`;
      log.push({ round, stage: "cyber-gate", ok: false, detail: feedback });
      continue; // nothing from this round is applied; the model gets another shot
    }

    // Syntax gate (js/mjs/cjs) — atomic across all edits before any write.
    const syntaxFailure = gen.edits.map((edit) => ({ edit, check: syntaxCheck(edit.path, edit.content) })).find(({ check }) => !check.ok);
    if (syntaxFailure) {
      feedback = `sintaxe invalida em ${syntaxFailure.edit.path}: ${syntaxFailure.check.error}`;
      log.push({ round, stage: "syntax", ok: false, detail: feedback });
      continue;
    }

    // All gates passed — apply.
    for (const edit of gen.edits) {
      writeFileSync(path.join(cwd, edit.path), edit.content, "utf8");
    }
    applied = true;
    appliedFiles = gen.edits.map((edit) => edit.path);
    log.push({ round, stage: "apply", ok: true, detail: appliedFiles.join(", ") });

    if (!testCmd) {
      passed = null;
      break;
    }

    const testResult = runTestCmd(testCmd, cwd);
    lastTestOutput = testResult.output;
    log.push({ round, stage: "test", ok: testResult.pass, detail: testResult.output.slice(0, 300) });

    if (testResult.pass) {
      // REGRESSÃO (lição it.22): o teste da tarefa passou, mas um whole-file edit pode ter
      // dropado código não-relacionado. Se editou o CLI, roda o smoke de comandos; se regrediu,
      // NÃO conta como passado — devolve o feedback e itera.
      const regCmds = [];
      if (files.some((f) => String(f).replace(/\\/g, "/").startsWith("mz-cli/src/"))) {
        regCmds.push("node mz-cli/test/commands-smoke.mjs");
      }
      let regFail = null;
      for (const rc of regCmds) {
        const rr = runTestCmd(rc, cwd);
        if (!rr.pass) { regFail = { cmd: rc, out: rr.output }; break; }
      }
      if (regFail) {
        log.push({ round, stage: "regression", ok: false, detail: `${regFail.cmd}: ${regFail.out.slice(0, 200)}` });
        passed = false;
        feedback = `o teste da tarefa passou MAS houve REGRESSÃO em "${regFail.cmd}":\n${regFail.out}\nRefaça o edit SEM remover código não-relacionado do arquivo.`;
        continue;
      }
      passed = true;
      break;
    }

    passed = false;
    feedback = `o teste falhou:\n${testResult.output}\nCorrija a causa raiz.`;
  }

  // ROLLBACK FINAL (fix auditoria it.64): se a última rodada aplicou mas o teste FALHOU,
  // a árvore ficaria suja com o edit que não passa. Reseta SÓ os alvos (nunca reset --hard),
  // deixando a árvore limpa; as tentativas ficam no `log`.
  let rolledBack = false;
  if (applied && passed === false && testCmd) {
    resetFiles(files, cwd);
    rolledBack = true;
    log.push({ round: roundsAttempted, stage: "rollback", ok: true, detail: "teste falhou na última rodada — alvos resetados" });
  }

  return {
    applied,
    passed,
    rolled_back: rolledBack,
    rounds: roundsAttempted,
    files: appliedFiles.length ? appliedFiles : files,
    cyber_blocked: cyberBlocked,
    log,
    testOutput: lastTestOutput,
  };
}
