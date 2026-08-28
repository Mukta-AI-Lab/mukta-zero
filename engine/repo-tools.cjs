// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// repo-tools.cjs — Fase 2 (A1-A3): ferramentas TRUSTED de CONTEXTO DE REPOSITÓRIO para o code-agent. Ler/buscar/editar
// um repo Mukta REAL (não bundles input_files). Operações determinísticas do host (worker/runtime) — NENHUM código
// não-confiável roda aqui (isso é a fronteira G3). Confinado a repos Mukta pelo repoInScope (fail-closed). apply-patch
// usa `git apply --check` → ATÔMICO (fail-closed embutido: patch que não aplica limpo NÃO toca o FS). Mesma doutrina R1
// do §11.9 (valida tudo antes de escrever). Exporta { prepareRepo, tree, readFile, grep, symbols, applyPatch, repoInScope }.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const refusal = require("./refusal-gate.cjs"); // Carta Plano 2: re-gate do PATCH (o dano mora no artefato; guard-tamper por dado de repo)

// ── A1: scope-guard de repo — só repos Mukta (remote H3rb-Mukta OU path sob a raiz Mukta) ──
const MUKTA_REMOTE_RE = /(?:github\.com[:/])H3rb-Mukta\/[\w.-]+/i;
function repoInScope(target) {
  const t = String(target || "");
  if (MUKTA_REMOTE_RE.test(t)) return true;
  // path local: precisa apontar p/ um repo cujo remote origin é Mukta (checado em prepareRepo)
  return false;
}
function git(root, args, input) {
  return execFileSync("git", args, { cwd: root, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}
function gitSafe(root, args, input) { try { return { ok: true, out: git(root, args, input) }; } catch (e) { return { ok: false, out: String(e.stdout || ""), err: String(e.stderr || e.message || "").slice(0, 500) }; } }

// confinamento léxico do path (idêntico ao bootstrap §11.9): rejeita abs e `..`, confina a root
function safeRel(root, rel) {
  const p = String(rel || "");
  if (!p || p[0] === "/" || p[0] === "\\" || /^[a-z]:/i.test(p)) throw new Error("abs_path");
  const segs = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") throw new Error("traversal");
    segs.push(seg);
  }
  const full = path.normalize(path.join(root, ...segs));
  const rootN = path.normalize(root);
  if (full !== rootN && !full.startsWith(rootN + path.sep)) throw new Error("escape");
  return full;
}

// ── A1: prepara o repo no workspace. remote Mukta → clone; localPath → valida que o origin é Mukta. ──
function prepareRepo({ remote, localPath, workspaceRoot }) {
  if (localPath) {
    const r = gitSafe(localPath, ["remote", "get-url", "origin"]);
    const origin = r.ok ? r.out.trim() : "";
    if (!repoInScope(origin) && !/mukta/i.test(origin)) throw new Error("repo_out_of_scope: " + origin.slice(0, 60));
    return { root: path.resolve(localPath), origin };
  }
  if (!repoInScope(remote)) throw new Error("remote_out_of_scope: " + String(remote).slice(0, 60));
  const name = String(remote).replace(/\.git$/, "").split(/[/:]/).pop();
  const dest = path.join(workspaceRoot || process.cwd(), "repo-" + name);
  if (!fs.existsSync(dest)) { const c = gitSafe(process.cwd(), ["clone", "--depth", "50", remote, dest]); if (!c.ok) throw new Error("clone_failed: " + c.err); }
  return { root: dest, origin: remote };
}

// ── A2: árvore de arquivos (git ls-files, limitada por subdir + profundidade) ──
function tree(root, sub = ".", maxDepth = 3) {
  const r = gitSafe(root, ["ls-files", sub === "." ? "" : sub].filter(Boolean));
  const files = (r.ok ? r.out : "").split("\n").filter(Boolean);
  const dirs = new Set(); const shown = [];
  for (const f of files) {
    const parts = f.split("/");
    if (parts.length <= maxDepth) shown.push(f);
    else dirs.add(parts.slice(0, maxDepth).join("/") + "/…");
  }
  return { files: shown.slice(0, 400), truncated_dirs: [...dirs].slice(0, 100), total: files.length };
}

// ── A2: leitura de arquivo (confinada), com range opcional ──
function readFile(root, rel, startLine, endLine) {
  const abs = safeRel(root, rel);
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  const s = Math.max(1, Number(startLine) || 1);
  const e = Math.min(lines.length, Number(endLine) || lines.length);
  return { path: rel, start: s, end: e, total_lines: lines.length, content: lines.slice(s - 1, e).map((l, i) => (s + i) + "\t" + l).join("\n") };
}

// ── A2: busca (git grep -n) ──
function grep(root, pattern, { glob, maxMatches = 120 } = {}) {
  const args = ["grep", "-n", "-I", "--no-color", "-e", String(pattern)];
  if (glob) args.push("--", glob);
  const r = gitSafe(root, args); // git grep sai 1 quando não há match (não é erro)
  return (r.out || "").split("\n").filter(Boolean).slice(0, maxMatches);
}

// ── A2: símbolos de um arquivo (leve, por regex de definição — sem LSP) ──
function symbols(root, rel) {
  const abs = safeRel(root, rel);
  const src = fs.readFileSync(abs, "utf8").split("\n");
  const out = [];
  const RE = /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let|def|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
  src.forEach((l, i) => { const m = l.match(RE); if (m) out.push({ name: m[1], line: i + 1 }); });
  return out.slice(0, 200);
}

// ── A3: apply-patch FAIL-CLOSED via `git apply` (atômico: --check dry-run primeiro; nunca aplica parcial) ──
function applyPatch(root, patch) {
  let p = String(patch || "").replace(/\r\n/g, "\n"); // normaliza CRLF→LF
  if (!p.trim()) return { applied: false, reason: "empty_patch" };
  // Carta Plano 2 (furo guard-tamper por dado de repo): screena o DIFF antes de qualquer `git apply`. Patch que toca
  // GUARD_FILES ou embute secret/SQL destrutivo é recusado fail-closed — mesmo com pedido top-level benigno.
  const scr = refusal.screenPatch(p);
  if (scr.decision !== "allow") return { applied: false, reason: scr.category || "refused", detail: scr.reason };
  if (!p.endsWith("\n")) p += "\n"; // git apply exige newline final
  // fail-closed em 2 fases: --check (dry-run) ANTES de aplicar. Tenta estrito, depois tolerante a whitespace.
  const flagSets = [["--whitespace=nowarn"], ["--ignore-whitespace", "--whitespace=nowarn"]];
  let lastErr = "";
  for (const flags of flagSets) {
    const chk = gitSafe(root, ["apply", "--check", ...flags, "-"], p);
    if (!chk.ok) { lastErr = chk.err; continue; }
    const app = gitSafe(root, ["apply", ...flags, "-"], p);
    if (app.ok) return { applied: true };
    lastErr = app.err;
  }
  return { applied: false, reason: "check_failed", detail: lastErr };
}

// ── A3: reset de arquivos ao HEAD (p/ cada rodada de self-repair partir do estado original, sem acumular patches) ──
function reset(root, files) {
  const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
  if (!list.length) return { ok: false };
  return { ok: gitSafe(root, ["checkout", "--", ...list]).ok };
}
// leitura RAW (sem numeração) — p/ empacotar em input_files da G3
function readRaw(root, rel) { return fs.readFileSync(safeRel(root, rel), "utf8"); }

// ── A5: operações Git. Escrita LOCAL (branch/commit/diff/status) é segura. PUSH/PR são OUTWARD → gated por repoInScope
// (só repo Mukta) e o DEFAULT do agente é BRANCH + PR p/ revisão humana (NUNCA push direto na base). ──
function originOf(root) { const r = gitSafe(root, ["remote", "get-url", "origin"]); return r.ok ? r.out.trim() : ""; }
function branch(root, name) {
  if (!/^[a-zA-Z0-9._/-]{1,80}$/.test(String(name || "")) || /\.\.|^\/|\/$/.test(String(name))) return { ok: false, error: "bad_branch_name" };
  const r = gitSafe(root, ["checkout", "-B", name]);
  return r.ok ? { ok: true, branch: name } : { ok: false, error: r.err };
}
function commit(root, message, files) {
  gitSafe(root, Array.isArray(files) && files.length ? ["add", ...files] : ["add", "-A"]);
  const r = gitSafe(root, ["commit", "-m", String(message || "code-agent change").slice(0, 500)]);
  if (!r.ok) return { ok: false, error: r.err };
  const sha = gitSafe(root, ["rev-parse", "HEAD"]);
  return { ok: true, sha: sha.ok ? sha.out.trim() : null };
}
function diff(root, staged) { const r = gitSafe(root, staged ? ["diff", "--staged"] : ["diff"]); return { ok: r.ok, diff: (r.out || "").slice(0, 60000) }; }
function status(root) { const r = gitSafe(root, ["status", "--porcelain"]); return { ok: r.ok, changes: (r.out || "").split("\n").filter(Boolean) }; }
// PR via gh — OUTWARD: exige repo Mukta + push da BRANCH (nunca da base). Token gh via env GH_TOKEN / gh auth (Vault em prod).
function openPR(root, opts) {
  const origin = originOf(root);
  if (!repoInScope(origin) && !/mukta/i.test(origin)) return { ok: false, error: "repo_out_of_scope", origin };
  const br = String(opts.branch || "");
  if (!br) return { ok: false, error: "missing_branch" };
  const cur = gitSafe(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const base = String(opts.base || "main");
  if (cur.ok && cur.out.trim() === base) return { ok: false, error: "refuse_pr_from_base" }; // nunca PR a partir da base
  const p = gitSafe(root, ["push", "-u", "origin", br]);
  if (!p.ok) return { ok: false, error: "push_failed", detail: p.err };
  try {
    const out = execFileSync("gh", ["pr", "create", "--title", String(opts.title || "code-agent PR").slice(0, 200), "--body", String(opts.body || "").slice(0, 4000), "--base", base, "--head", br], { cwd: root, encoding: "utf8" });
    return { ok: true, url: out.trim() };
  } catch (e) { return { ok: false, error: "gh_failed", detail: String(e.stderr || e.message).slice(0, 300) }; }
}

module.exports = { prepareRepo, tree, readFile, readRaw, grep, symbols, applyPatch, reset, branch, commit, diff, status, openPR, originOf, repoInScope, safeRel };

// ── SELF-TEST (rodado se chamado direto): exercita A2/A3 no repo REAL + apply-patch num repo temp isolado ──
if (require.main === module) {
  const root = process.cwd();
  let pass = 0, fail = 0;
  const ok = (name, cond, extra) => { console.log((cond ? "  ✓ " : "  ✗ ") + name + (extra ? " — " + extra : "")); cond ? pass++ : fail++; };

  console.log("REPO-TOOLS self-test\n== A2 no repo real (" + path.basename(root) + ") ==");
  const t = tree(root, "scripts/agent", 3);
  ok("tree lista agent-runtime.cjs", t.files.some((f) => f.includes("agent-runtime.cjs")), t.total + " arquivos");
  const g = grep(root, "runCodeExec", { glob: "integrations/companion-vm-worker/src/index.ts" });
  ok("grep acha runCodeExec", g.length > 0, g.length + " matches");
  const rd = readFile(root, "scripts/agent/scope-guard.cjs", 1, 3);
  ok("readFile range 1-3", rd.content.split("\n").length === 3 && /scope-guard/.test(rd.content));
  const sy = symbols(root, "scripts/agent/repo-tools.cjs");
  ok("symbols acha prepareRepo", sy.some((s) => s.name === "prepareRepo"), sy.length + " símbolos");

  console.log("== confinamento (deve REJEITAR) ==");
  ok("readFile ../../etc rejeitado", (() => { try { readFile(root, "../../etc/passwd"); return false; } catch (e) { return e.message === "traversal"; } })());
  ok("readFile /etc absoluto rejeitado", (() => { try { readFile(root, "/etc/passwd"); return false; } catch (e) { return e.message === "abs_path"; } })());

  console.log("== A3 apply-patch (repo temp isolado) ==");
  const tmp = path.join(require("os").tmpdir(), "repo-tools-test-" + process.pid);
  try {
    fs.mkdirSync(tmp, { recursive: true });
    git(tmp, ["init", "-q"]); git(tmp, ["config", "user.email", "t@t"]); git(tmp, ["config", "user.name", "t"]);
    fs.writeFileSync(path.join(tmp, "f.txt"), "linha1\nlinha2\nlinha3\n");
    git(tmp, ["add", "-A"]); git(tmp, ["commit", "-q", "-m", "init"]);
    const goodPatch = "--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n linha1\n-linha2\n+LINHA2-EDITADA\n linha3\n";
    const r1 = applyPatch(tmp, goodPatch);
    ok("patch limpo aplica", r1.applied === true);
    ok("conteúdo editado", fs.readFileSync(path.join(tmp, "f.txt"), "utf8").includes("LINHA2-EDITADA"));
    // patch que NÃO casa (contexto errado) → deve ABORTAR sem tocar o FS
    const before = fs.readFileSync(path.join(tmp, "f.txt"), "utf8");
    const badPatch = "--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n linhaX\n-naoexiste\n+outra\n linhaZ\n";
    const r2 = applyPatch(tmp, badPatch);
    ok("patch ruim ABORTA (fail-closed)", r2.applied === false && r2.reason === "check_failed");
    ok("FS intacto após patch ruim", fs.readFileSync(path.join(tmp, "f.txt"), "utf8") === before);

    console.log("== A5 git ops (branch/commit/diff/status) ==");
    const b = branch(tmp, "code-agent/fix-1");
    ok("branch cria+checkout", b.ok && b.branch === "code-agent/fix-1");
    ok("branch nome inválido rejeitado", branch(tmp, "../evil").ok === false && branch(tmp, "a b").ok === false);
    fs.writeFileSync(path.join(tmp, "f.txt"), "linha1\nEDIT-A5\nlinha3\n");
    ok("status vê mudança", status(tmp).changes.some((c) => c.includes("f.txt")));
    ok("diff mostra o hunk", /EDIT-A5/.test(diff(tmp).diff));
    const c = commit(tmp, "test: A5 commit");
    ok("commit gera sha", c.ok && /^[0-9a-f]{40}$/.test(c.sha || ""));
    ok("openPR em repo sem origin Mukta rejeita (OUTWARD gated)", openPR(tmp, { branch: "code-agent/fix-1", title: "x" }).error === "repo_out_of_scope");
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ } }

  console.log("\n" + (fail === 0 ? "✅ TODOS PASSARAM" : "⚠️ " + fail + " FALHA(S)") + " (" + pass + "/" + (pass + fail) + ")");
  process.exit(fail === 0 ? 0 : 1);
}
