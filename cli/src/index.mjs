#!/usr/bin/env node
// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz — standalone CLI, "mao local / cerebro nuvem". Runs Mukta
 * Zero agents on behalf of a real Mukta user, using ONLY that user's JWT.
 *
 * Usage:
 *   mz login <username>
 *   mz ask "<prompt>" [--agent <agent_id>] [--company <company_id>] [--json]
 */

import readline from "node:readline";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createAuthedClient, saveSession, restoreClient, sessionPath, clearSession, localIdentity } from "./auth.mjs";
import { sessionLabel, conversationId } from "./session.mjs";
import { recordRun, listRuns, getRun, listSessions } from "./run-store.mjs";
import { searchProject } from "./search.mjs";
import { banner } from "./banner.mjs";
import { resolveCompany, resolveAgent, askAgent, extractResponseText } from "./api.mjs";
import { localReview, cloudReview, combineReport } from "./review.mjs";
import { buildLoop } from "./build.mjs";
import { patchLoop } from "./patch.mjs";
import { execSync, execFileSync, spawn } from "node:child_process";
import { localize, agentLoop } from "./agent.mjs";
import { assembleSystem, sealedSystem, personaPaths } from "./persona.mjs";
import { selectState } from "./state.mjs";
import { saveState, listStates, loadApprovedStates, approveState } from "./state-store.mjs";
import { pushChanges, openPr } from "./git-ops.mjs";
import { setProvider, listProviders, removeProvider, getProvider } from "./providers.mjs";
import { callDirect } from "./llm-direct.mjs";
import { loadTarget, setTarget, clearTarget, targetPath } from "./target.mjs";
import { SUPABASE_URL, COMPANION_RUNTIME_BASE_URL, ACTIVE_TARGET_KIND, CLI_AUTH_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.mjs";
import { decomposeGoal, executePlan } from "./plan.mjs";
import { listarFalhas, cobertura, formatarFalha, formatarCobertura } from "./falhas.mjs"; // FB6-a: log de falhas no terminal (espelha a aba Falhas do app.example.com)
import { runLoop } from "./loop.mjs"; // motor de loop AUTORADO pelo próprio MZ (mz build); wiring do comando = supervisor
import { runWorkflow } from "./workflow.mjs"; // motor de workflow multi-times AUTORADO pelo MZ; wiring = supervisor
import { saveWake, listWakes, loadWake, updateWake, dueWakes } from "./wake.mjs"; // motor de wake AUTORADO pelo MZ; wiring = supervisor

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function printUsage() {
  console.error(
    [
      "Usage:",
      "  mz                                               (abre a JANELA: abas, @arquivos, +anexos, /comandos)",
      "  mz tui | chat [--mode conversa|plano|agente|auto]",
      "  mz login <username>",
      "  mz logout | whoami [--json]                      (encerra/mostra a sessão desta aba)",
      "  mz history [show <id> | sessions] [--json]       (histórico de runs desta aba)",
      '  mz search "<regex>" [--path <dir>] [--fixed] [--max <n>] [--json]  (busca no projeto)',
      '  mz ask "<prompt>" [--provider <name>] [--model <m>] [--agent <id>] [--company <id>] [--async|--resume <job_id>] [--timeout <s>] [--json]',
      "  mz review <file> [--company <id>] [--agent <id>] [--json] [--local-only]",
      '  mz build "<spec>" [--lang py|js] [--test <file>] [--out <file>] [--company <id>] [--agent <id>] [--allow-exec] [--json]',
      '  mz patch <arquivo> "<mudança>" [--allow-exec] [--company <id>] [--agent <id>] [--json]',
      '  mz agent "<task>" [--file <f>]... [--test "<cmd>"] [--max <n>] [--company <id>] [--agent <id>]',
      '  mz plan "<objetivo>" [--dry-run] [--approve-privileged]',
      '  mz loop "<objetivo>" [--until "<cmd>"] [--times <n>] [--interval <s>] [--approve-privileged]',
      '  mz workflow "<t1>" "<t2>" ... [--concurrency <n>] [--approve-privileged]',
      '  mz wake schedule "<objetivo>" [--at <ISO>] | list | resume <id> | run-due',
      "  mz config set-provider <name> --key <k> [--base-url <u>] [--model <m>]",
      "  mz config list-providers | remove-provider <name>",
      "  mz init [--global]",
      "  mz target set --url <kong-url> --key <anon> [--runtime <url>] | show | clear",
      "  mz version, -v",
    ].join("\n")
  );
}

function printHelp() {
  console.log(
    [
      "Usage:",
      "  mz                                               (JANELA ÚNICA — abas de execução, @arquivos, +anexos, /comandos, Shift+Tab troca o modo)",
      "  mz tui | chat [--mode conversa|plano|agente|auto]  (a mesma janela, já num modo)",
      "  mz login <username>",
      "  mz logout | whoami [--json]                      (encerra/mostra a sessão desta aba)",
      "  mz history [show <id> | sessions] [--json]       (histórico de runs desta aba)",
      '  mz search "<regex>" [--path <dir>] [--fixed] [--max <n>] [--json]  (busca no projeto)',
      '  mz ask "<prompt>" [--provider <name>] [--model <m>] [--agent <id>] [--company <id>] [--async|--resume <job_id>] [--timeout <s>] [--json]',
      "  mz review <file> [--company <id>] [--agent <id>] [--json] [--local-only]",
      '  mz build "<spec>" [--lang py|js] [--test <file>] [--out <file>] [--company <id>] [--agent <id>] [--allow-exec] [--json]',
      '  mz patch <arquivo> "<mudança>" [--allow-exec] [--company <id>] [--agent <id>] [--json]',
      '  mz agent "<task>" [--file <f>]... [--test "<cmd>"] [--max <n>] [--company <id>] [--agent <id>]',
      '  mz plan "<objetivo>" [--dry-run] [--approve-privileged]        (planejador multi-etapas: decompõe→executa→verifica→replan)',
      '  mz loop "<objetivo>" [--until "<cmd>"] [--times <n>] [--interval <s>]   (roda o planejador em loop até a condição)',
      '  mz workflow "<t1>" "<t2>" ... [--concurrency <n>]              (orquestra vários times/planos em paralelo)',
      '  mz wake schedule "<obj>" [--at <ISO>] | list | resume <id> | run-due   (agenda/retoma trabalho multi-etapas)',
      "  mz config set-provider <name> --key <k> [--base-url <u>] [--model <m>]  (BYOK: call a provider directly)",
      "  mz config list-providers | remove-provider <name>",
      "  mz init [--global]                                (scaffold local persona/memory files, style /init)",
      "  mz target set --url <kong> --key <anon> [--runtime <url>] | show | clear   (aponta p/ instância própria)",
      "  mz version, -v",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--agent") {
      args.agent = argv[i += 1];
    } else if (token === "--company") {
      args.company = argv[i += 1];
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--local-only") {
      args.localOnly = true;
    } else if (token === "--lang") {
      args.lang = argv[i += 1];
    } else if (token === "--test") {
      args.test = argv[i += 1];
    } else if (token === "--out") {
      args.out = argv[i += 1];
    } else if (token === "--file") {
      (args.file = args.file || []).push(argv[i += 1]);
    } else if (token === "--max") {
      args.max = argv[i += 1];
    } else if (token === "--provider") {
      args.provider = argv[i += 1];
    } else if (token === "--key") {
      args.key = argv[i += 1];
    } else if (token === "--base-url") {
      args.baseUrl = argv[i += 1];
    } else if (token === "--model") {
      args.model = argv[i += 1];
    } else if (token === "--global") {
      args.global = true;
    } else if (token === "--project") {
      args.project = true;
    } else if (token === "--url") {
      args.url = argv[i += 1];
    } else if (token === "--runtime") {
      args.runtime = argv[i += 1];
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--approve-privileged") {
      args.approvePrivileged = true;
    } else if (token === "--times") {
      args.times = argv[i += 1];
    } else if (token === "--until") {
      args.until = argv[i += 1];
    } else if (token === "--interval") {
      args.interval = argv[i += 1];
    } else if (token === "--concurrency") {
      args.concurrency = argv[i += 1];
    } else if (token === "--at") {
      args.at = argv[i += 1];
    } else if (token === "--desc") {
      args.desc = argv[i += 1];
    } else if (token === "--persona") {
      args.persona = argv[i += 1];
    } else if (token === "--keywords") {
      args.keywords = argv[i += 1];
    } else if (token === "--approve") {
      args.approve = true;
    } else if (token === "--message" || token === "-m") {
      args.message = argv[i += 1];
    } else if (token === "--pr") {
      args.pr = true;
    } else if (token === "--base") {
      args.base = argv[i += 1];
    } else if (token === "--allow-default") {
      args.allowDefault = true;
    } else if (token === "--no-push") {
      args.noPush = true;
    } else if (token === "--branch") {
      args.branch = argv[i += 1];
    } else if (token === "--allow-exec") {
      args.allowExec = true;
    } else if (token === "--session") {
      args.session = argv[i += 1];
    } else if (token === "--path") {
      args.path = argv[i += 1];
    } else if (token === "--fixed") {
      args.fixed = true;
    } else if (token === "--async") {
      args.async = true;
    } else if (token === "--resume") {
      args.resume = argv[i += 1];
    } else if (token === "--timeout") {
      args.timeout = argv[i += 1];
    } else if (token === "--dias") {
      args.dias = argv[i += 1];
    } else if (token === "--run") {
      args.run = argv[i += 1];
    } else if (token === "--limit") {
      args.limit = argv[i += 1];
    } else if (token === "--mode") {
      args.mode = argv[i += 1];
    } else {
      args._.push(token);
    }
  }
  return args;
}

/** Reads a line from stdin without echoing it back to the terminal. */
function promptHidden(promptText) {
  return new Promise((resolve) => {
    process.stdout.write(promptText);
    const stdin = process.stdin;

    if (!stdin.isTTY) {
      // Non-interactive stdin (piped) — read ALL of stdin (accumulate chunks
      // until 'end'), so a password piped WITHOUT a trailing newline still works.
      // (readline.question required a newline and silently read empty otherwise —
      // the login-via-pipe bug found in it.21.)
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk) => {
        data += chunk;
      });
      stdin.on("end", () => {
        resolve(data.replace(/\r?\n$/, ""));
      });
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let input = "";

    const onData = (char) => {
      switch (char) {
        case "\n":
        case "\r":
        case "\u0004": // Ctrl-D
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(input);
          break;
        case "\u0003": // Ctrl-C
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
          break;
        case "\u007f": // Backspace (DEL)
        case "\b":
          input = input.slice(0, -1);
          break;
        default:
          input += char;
          break;
      }
    };

    stdin.on("data", onData);
  });
}

async function cmdLogin(args) {
  const username = args._[0];
  if (!username) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const password = await promptHidden(`Password for ${username}: `);
  if (!password) {
    console.error("Password required.");
    process.exitCode = 1;
    return;
  }

  try {
    const auth = await createAuthedClient(username, password);
    saveSession(username, auth.session);
    console.log(`Logged in as ${username}. Session saved to ${sessionPath()}`);
  } catch (err) {
    console.error(`Login failed: ${err.message}`);
    process.exitCode = 1;
  }
}

// mz auth — device-authorization flow: abre o navegador → user loga e autoriza → token 24h → sessão.
// Alternativa ao `mz login <user>` (senha no terminal). Não guarda senha; recebe só o JWT 24h.
async function cmdAuth() {
  const H = { apikey: SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" };
  let s;
  try {
    const r = await fetch(CLI_AUTH_URL, { method: "POST", headers: H, body: JSON.stringify({ action: "start", client_name: "mz-cli" }) });
    s = await r.json();
  } catch (e) { console.error(`Falha ao contatar o servidor de auth: ${e.message}`); process.exitCode = 1; return; }
  if (!s?.device_code) { console.error(`Falha ao iniciar auth: ${s?.error || "?"}`); process.exitCode = 1; return; }
  console.log(`\n  Abra no navegador:  ${s.verification_url}`);
  console.log(`  Código de verificação:  ${s.user_code}\n`);
  console.log("  Faça login e autorize. Aguardando aprovação...");
  try {
    const opener = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const oargs = process.platform === "win32" ? ["/c", "start", "", s.verification_url] : [s.verification_url];
    spawn(opener, oargs, { stdio: "ignore", detached: true }).unref();
  } catch { /* usuário abre o link manualmente */ }
  const interval = (s.interval || 3) * 1000;
  const deadline = Date.now() + (s.expires_in || 600) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    let p;
    try { const r = await fetch(CLI_AUTH_URL, { method: "POST", headers: H, body: JSON.stringify({ action: "poll", device_code: s.device_code }) }); p = await r.json(); }
    catch { process.stdout.write("."); continue; }
    if (p.status === "approved" && p.access_token) {
      let username = "mz-user";
      try { const c = JSON.parse(Buffer.from(p.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); username = c.email || c.sub || username; } catch { /* */ }
      saveSession(username, { access_token: p.access_token, refresh_token: null, expires_at: Math.floor(Date.now() / 1000) + (p.expires_in || 86400) });
      console.log(`\n  ✓ Autorizado como ${username}. Sessão de 24h salva em ${sessionPath()}`);
      return;
    }
    if (["expired", "not_found", "denied", "consumed", "rate_limited"].includes(p.status)) {
      console.error(`\n  Autorização ${p.status}. Rode 'mz auth' de novo.`); process.exitCode = 1; return;
    }
    process.stdout.write(".");
  }
  console.error("\n  Tempo esgotado sem aprovação. Rode 'mz auth' de novo.");
  process.exitCode = 1;
}

/**
 * Imprime o resultado de um `ask`/`--resume` (sync / --async / timeout-do-cliente) e seta o exit code.
 * Compartilhado pelo caminho normal e pelo --resume. Exit: 0 ok · 1 erro real · 3 timeout-do-cliente
 * (job vivo, resultado recuperável via --resume).
 */
function emitAskResult(args, result) {
  // --async: submetido, não aguardado — devolve o job_id p/ retomar.
  if (result.status === 202 && result.payload && result.payload.job_id) {
    const jid = result.payload.job_id;
    if (args.json) console.log(JSON.stringify({ ok: true, async: true, job_id: jid }, null, 2));
    else { console.log(`job submetido: ${jid}`); console.error(`Recupere o resultado com: mz ask --resume ${jid}`); }
    process.exitCode = 0;
    return;
  }
  // Timeout do budget do CLIENTE — o job SEGUE no servidor; resultado persiste (mz_jobs/mz_messages).
  if (result.status === 504 && result.payload && result.payload.job_id) {
    const jid = result.payload.job_id;
    if (args.json) console.log(JSON.stringify({ ok: false, error: "job timeout (cliente)", job_id: jid, still_running: true }, null, 2));
    else console.error(
      `A tarefa excedeu o tempo de espera do CLIENTE, mas CONTINUA rodando no servidor.\n` +
        `Recupere o resultado quando pronto com:  mz ask --resume ${jid}\n` +
        `(ou espere mais da próxima vez:  mz ask "<prompt>" --timeout <segundos>)`
    );
    process.exitCode = 3; // job vivo, resultado recuperável — distinto de erro real (1)
    return;
  }
  // Job FALHOU no servidor (ex.: run-agent-chat interno estourou o gateway em pesquisa pesada) — NÃO é 502
  // transiente nem timeout-de-cliente; surface o erro/fase reais em vez de um "HTTP 502" enganoso.
  if (result.status === 502 && result.payload && result.payload.server_failed) {
    const e = result.payload;
    if (args.json) console.log(JSON.stringify({ ok: false, server_failed: true, error: e.error, phase: e.phase ?? null, job_id: e.job_id ?? null }, null, 2));
    else console.error(`O job FALHOU no servidor${e.phase ? ` (fase: ${e.phase})` : ""}: ${e.error}. Não é erro do CLI nem 502 transiente — o job não completou (provável tarefa longa demais p/ o orçamento do runtime).`);
    process.exitCode = 1;
    return;
  }
  if (!result.ok) {
    const message =
      (result.payload && result.payload.error && (result.payload.error.message || result.payload.error)) ||
      (result.rawText ? result.rawText.slice(0, 300) : `HTTP ${result.status}`);
    if (args.json) console.log(JSON.stringify({ ok: false, error: message, status: result.status }, null, 2));
    console.error(`Request failed (HTTP ${result.status}): ${message}`);
    process.exitCode = 1;
    return;
  }
  const text = extractResponseText(result);
  if (args.json) {
    const p = result.payload || {};
    console.log(JSON.stringify({ ok: true, text, model: p.model ?? p.model_used ?? p.model_slug ?? null, provider: p.provider ?? null, usage: p.usage ?? p.token_usage ?? null }, null, 2));
  } else {
    console.log(text || "(empty response)");
  }
  process.exitCode = text.trim().length > 0 ? 0 : 1;
}

async function cmdAsk(args) {
  const prompt = args._[0];
  const pollBudgetMs = args.timeout ? Math.max(5, Number(args.timeout) || 0) * 1000 : undefined;
  const onPhase = (ph) => process.stderr.write(`[fase: ${ph}]\n`);

  // --resume <job_id>: retoma o poll de um job async já submetido (não precisa de prompt).
  if (args.resume) {
    const auth = await restoreClient();
    if (!auth) { console.error("Not logged in (or session expired/invalid). Run: mz login <username>"); process.exitCode = 1; return; }
    try {
      const result = await askAgent(auth, { resumeJobId: String(args.resume), pollBudgetMs, onPhase });
      emitAskResult(args, result);
    } catch (err) { console.error(`Error: ${err.message}`); process.exitCode = 1; }
    return;
  }

  if (!prompt || prompt.startsWith("--")) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  // BYOK: `--provider <name>` routes DIRECTLY to a user-configured provider
  // (llm-direct) instead of the cloud agent — no login/JWT needed, the user's
  // own API key does the auth. (--async/--resume não se aplicam ao BYOK direto.)
  if (args.provider) {
    const conf = getProvider(args.provider);
    if (!conf) {
      console.error(
        `Provider "${args.provider}" nao configurado. ` +
          `Rode: mz config set-provider ${args.provider} --key <k> [--base-url <u>] [--model <m>]`
      );
      process.exitCode = 1;
      return;
    }
    const result = await callDirect(conf, { model: args.model || conf.default_model, system: assembleSystem(), user: prompt });
    if (!result.ok) {
      if (args.json) console.log(JSON.stringify({ ok: false, error: result.error || "erro desconhecido", status: result.status }, null, 2));
      console.error(`Request failed (HTTP ${result.status}): ${result.error || "erro desconhecido"}`);
      process.exitCode = 1;
      return;
    }
    if (args.json) {
      console.log(JSON.stringify({ ok: true, text: result.text, model: args.model || conf.default_model, provider: conf.name, usage: result.usage ?? null }, null, 2));
    } else {
      console.log(result.text || "(empty response)");
    }
    process.exitCode = (result.text || "").trim().length > 0 ? 0 : 1;
    return;
  }

  const auth = await restoreClient();
  if (!auth) {
    console.error("Not logged in (or session expired/invalid). Run: mz login <username>");
    process.exitCode = 1;
    return;
  }

  try {
    const companyId = await resolveCompany(auth.client, args.company || null);
    const agentId = await resolveAgent(auth.client, companyId, args.agent || null);
    // 7b state-tuning: se a tarefa casa um estado especialista aprovado, entra nele.
    // A persona do estado vai por sealedSystem() → herda o contrato 7a (guardas ANTES, não-burlável).
    const activeState = selectState(prompt, loadApprovedStates());
    if (activeState) console.error(`[estado especialista: ${activeState.name}]`);
    const system = activeState ? sealedSystem(activeState.persona) : assembleSystem();
    // session_id ESTÁVEL por conversa (persistido em conversation.json da sessão) → memória turno-a-turno.
    // Só no `ask` (conversacional); generateEdits/plan seguem one-shot sem session_id.
    const result = await askAgent(auth, {
      prompt, agentId, companyId,
      systemPromptOverride: system,
      sessionId: conversationId(),
      pollBudgetMs,
      asyncOnly: Boolean(args.async),
      onPhase,
    });
    emitAskResult(args, result);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

async function cmdReview(args) {
  const filePath = args._[0];
  if (!filePath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`Could not read ${filePath}: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  // Mao local — offline, deterministic signature gate. Always runs, no
  // network required.
  const local = localReview(source, filePath);

  let cloud = null;
  if (!args.localOnly) {
    const auth = await restoreClient();
    if (!auth) {
      console.error(
        "Not logged in (or session expired/invalid) — cloud review skipped. " +
          "Run: mz login <username>, or pass --local-only to skip the cloud step."
      );
      cloud = {
        ok: false,
        degraded: true,
        truncated: false,
        error: "not logged in",
        status: null,
        findings: [],
        summary: "",
        rawText: "",
      };
    } else {
      try {
        const companyId = await resolveCompany(auth.client, args.company || null);
        const agentId = await resolveAgent(auth.client, companyId, args.agent || null);
        cloud = await cloudReview(auth, { source, filename: filePath, agentId, companyId });
      } catch (err) {
        cloud = {
          ok: false,
          degraded: true,
          truncated: false,
          error: err.message,
          status: null,
          findings: [],
          summary: "",
          rawText: "",
        };
      }
    }
  }

  const report = combineReport(local, cloud, filePath, Boolean(args.json));
  console.log(report.text);
  process.exitCode = report.blocked ? 1 : 0;
}

/**
 * `mz build "<spec>"` — ask -> review -> build capstone. Direct one-shot
 * generation (see src/build.mjs buildLoop doc), auto-reviewed by the
 * offline cyber-defense gate before anything runs, optionally verified
 * against a real --test file (with up to 2 self-repair attempts fed the
 * actual test failure, not a guess).
 */
async function cmdBuild(args) {
  const spec = args._[0];
  if (!spec) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const lang = args.lang || "py";
  if (lang !== "py" && lang !== "js") {
    console.error(`--lang deve ser "py" ou "js" (recebido: ${args.lang})`);
    process.exitCode = 1;
    return;
  }

  if (args.test && !existsSync(args.test)) {
    console.error(`Arquivo de teste nao encontrado: ${args.test}`);
    process.exitCode = 1;
    return;
  }

  const auth = await restoreClient();
  if (!auth) {
    console.error("Not logged in (or session expired/invalid). Run: mz login <username>");
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    const companyId = await resolveCompany(auth.client, args.company || null);
    const agentId = await resolveAgent(auth.client, companyId, args.agent || null);

    result = await buildLoop(auth, {
      spec,
      lang,
      testFile: args.test || null,
      agentId,
      companyId,
      maxRepair: 2,
      allow: args.allowExec ? ["node_child_process", "deno_run"] : [],
    });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const lines = [`BUILD: lang=${lang} attempts=${result.attempts}`];
    if (result.error) {
      lines.push(`  geracao falhou: ${result.error}`);
    }
    if (result.review) {
      lines.push(`  review: verdict=${result.review.verdict} blocked=${result.review.blocked}`);
      if (result.review.blocked) {
        for (const f of result.review.findings) {
          lines.push(`    [${f.severity.toUpperCase()}] ${f.cwe || f.rule} (linha ${f.line ?? "?"}): ${f.message}`);
        }
      }
    }
    if (args.test) {
      if (result.tested) {
        lines.push(`  teste: ${result.passed ? "PASSOU" : "FALHOU"}`);
        if (!result.passed && result.testOutput) {
          lines.push("  saida do teste:");
          lines.push(result.testOutput.replace(/^/gm, "    "));
        }
      } else if (!result.blockedByReview) {
        lines.push("  teste: nao rodou");
      }
    }
    if (result.filename) lines.push(`  arquivo: ${result.filename}`);
    if (result.entryNote) lines.push(`  nota: ${result.entryNote}`);
    console.log(lines.join("\n"));

    if (result.code && !args.out) {
      console.log("\n--- CODE ---\n" + result.code);
    }
  }

  if (result.code && args.out) {
    // SEGURANÇA (fix auditoria it.64): NUNCA gravar código que o cyber-gate BLOQUEOU.
    // Antes, o write era incondicional em (code && out) — escrevia código flaggado no disco,
    // só sinalizando exit 1. Agora bloqueado → não escreve.
    if (result.blockedByReview) {
      console.error(`NAO escrito em ${args.out}: cyber-gate BLOQUEOU o codigo (findings acima). Ajuste a spec e rode de novo.`);
    } else {
      try {
        writeFileSync(args.out, result.code, "utf8");
        console.error(`Codigo escrito em ${args.out}`);
      } catch (err) {
        console.error(`Falha ao escrever ${args.out}: ${err.message}`);
        process.exitCode = 1;
        return;
      }
    }
  }

  const failed =
    Boolean(result.error) || result.blockedByReview === true || (Boolean(args.test) && result.passed !== true);
  process.exitCode = failed ? 1 : 0;
}

/**
 * cmdPatch — edita um ARQUIVO EXISTENTE por unified diff (git apply), via patchLoop.
 * Fecha o gap de arquivos grandes que o `mz build` (rewrite inteiro) não cobre. Via TRUSTED:
 * o CLI aplica o diff; o conteúdo resultante ainda passa pelo cyber-gate (reverte se bloquear).
 */
async function cmdPatch(args) {
  const filePath = args._[0];
  const spec = args._[1];
  if (!filePath || !spec) {
    console.error('uso: mz patch <arquivo> "<mudança desejada>" [--allow-exec] [--json]');
    process.exitCode = 1;
    return;
  }

  const auth = await restoreClient();
  if (!auth) {
    console.error("Not logged in (or session expired/invalid). Run: mz login <username>");
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    const companyId = await resolveCompany(auth.client, args.company || null);
    const agentId = await resolveAgent(auth.client, companyId, args.agent || null);
    result = await patchLoop(auth, {
      filePath,
      spec,
      agentId,
      companyId,
      maxRepair: 2,
      allow: args.allowExec ? ["node_child_process", "deno_run"] : [],
    });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const lines = [`PATCH: ${filePath} attempts=${result.attempts}`];
    if (result.ok) {
      lines.push(`  aplicado OK (${result.mode || "?"})${result.note ? " — " + result.note : ""}`);
      const fnd = result.review && Array.isArray(result.review.findings) ? result.review.findings : [];
      if (fnd.length) lines.push(`  gate: ${fnd.length} achado(s) nao-bloqueante(s)`);
    } else if (result.blockedByReview) {
      lines.push("  BLOQUEADO pelo cyber-gate — REVERTIDO ao original:");
      for (const f of result.review.findings) {
        lines.push(`    [${String(f.severity || "?").toUpperCase()}] ${f.rule || f.cwe} (linha ${f.line ?? "?"}): ${f.message}`);
      }
    } else {
      lines.push(`  falhou: ${result.error || "erro desconhecido"}`);
    }
    console.log(lines.join("\n"));
  }

  process.exitCode = result.ok ? 0 : 1;
}

/**
 * `mz falhas` — o log de falhas dos runs (FB6-a do canal MZ-CLI-eng ⇄ MZ-Front).
 *
 * Distingue DUAS respostas que uma lista vazia confunde: "nenhuma falha" e
 * "falhas não instrumentadas". Hoje `error_code`/`dod_passed` estão vazios em
 * todo o acervo, então sem essa distinção o comando pareceria quebrado — ou,
 * pior, afirmaria ausência de falhas sem poder medi-la.
 */
async function cmdFalhas(args) {
  const auth = await restoreClient();
  if (!auth) {
    console.error("Not logged in (or session expired/invalid). Run: mz auth");
    process.exitCode = 1;
    return;
  }
  const dias = Number(args.dias) || 30;
  const r = await listarFalhas(auth.client, { runId: args.run || null, limit: args.limit || args.max || 20 });
  if (!r.ok) {
    if (args.json) console.log(JSON.stringify({ ok: false, error: r.erro, detalhe: r.detalhe }, null, 2));
    else console.error(`Falha ao consultar: ${r.erro}${r.detalhe ? ` — ${r.detalhe}` : ""}`);
    process.exitCode = 1;
    return;
  }

  // A cobertura vai SEMPRE, não só quando a lista sai vazia: mesmo com falhas
  // listadas, o usuário precisa saber que `dod` está em 0% do acervo antes de
  // concluir que os passos "passaram". Instrumentação parcial engana mais que
  // instrumentação ausente, porque o que aparece parece o todo.
  const cob = await cobertura(auth.client, { dias });

  if (args.json) {
    console.log(JSON.stringify({ ok: true, falhas: r.falhas, total: r.total, cobertura: cob || null, janela_dias: dias }, null, 2));
  } else if (r.falhas.length) {
    console.log(r.falhas.map(formatarFalha).join("\n\n"));
    console.error(`\n${r.falhas.length} falha(s)${r.total > r.falhas.length ? ` de ${r.total}` : ""}.`);
    console.error(`\n${formatarCobertura(cob, { dias })}`);
  } else if (cob && cob.status_failed > 0) {
    console.log(`Nenhuma falha na janela consultada, mas o acervo tem ${cob.status_failed} run(s) com status='failed' nos últimos ${dias} dias.`);
    console.log("Aumente o alcance com --limit, ou a janela com --dias.");
  } else {
    console.log("Nenhuma falha registrada.");
    console.log(formatarCobertura(cob, { dias }));
    console.log("\nCobertura baixa NÃO é o mesmo que ausência de falha — os campos acima dizem o que este acervo permite afirmar.");
  }
  process.exitCode = 0;
}

function cmdVersion() {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    console.log(pkg.version || "unknown");
  } catch (err) {
    console.error(`Could not read version: ${err.message}`);
    process.exitCode = 1;
  }
}

/**
 * `mz config <sub>` — BYOK provider config (~/.mukta/providers.json, 0600).
 * Sub-commands: set-provider <name> --key <k> [--base-url <u>] [--model <m>],
 * list-providers, remove-provider <name>. The api_key is NEVER echoed.
 */
function cmdConfig(args) {
  const sub = args._[0];

  if (sub === "set-provider") {
    const name = args._[1];
    if (!name) {
      console.error("Uso: mz config set-provider <name> --key <k> [--base-url <u>] [--model <m>]");
      process.exitCode = 1;
      return;
    }
    if (!args.key) {
      console.error("--key <api_key> e obrigatorio.");
      process.exitCode = 1;
      return;
    }
    try {
      const saved = setProvider(name, {
        apiKey: args.key,
        baseUrl: args.baseUrl || null,
        defaultModel: args.model || null,
      });
      // NUNCA ecoar a chave — só nome/base_url/mascara/model.
      console.log(
        `provider ${saved.name} salvo (base_url=${saved.base_url}, chave=${saved.api_key_masked}` +
          `${saved.default_model ? `, model=${saved.default_model}` : ""}).`
      );
    } catch (err) {
      console.error(`Erro: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (sub === "list-providers") {
    const rows = listProviders();
    if (!rows.length) {
      console.log("(nenhum provider configurado — use: mz config set-provider <name> --key <k>)");
      return;
    }
    console.log(["NAME", "BASE_URL", "KEY", "DEFAULT_MODEL"].join("\t"));
    for (const r of rows) {
      console.log([r.name, r.base_url || "-", r.api_key_masked, r.default_model || "-"].join("\t"));
    }
    return;
  }

  if (sub === "remove-provider") {
    const name = args._[1];
    if (!name) {
      console.error("Uso: mz config remove-provider <name>");
      process.exitCode = 1;
      return;
    }
    const removed = removeProvider(name);
    if (removed) {
      console.log(`provider ${name} removido.`);
    } else {
      console.error(`provider ${name} nao encontrado.`);
      process.exitCode = 1;
    }
    return;
  }

  console.error(
    "Uso: mz config <set-provider|list-providers|remove-provider>\n" +
      "  mz config set-provider <name> --key <k> [--base-url <u>] [--model <m>]\n" +
      "  mz config list-providers\n" +
      "  mz config remove-provider <name>"
  );
  process.exitCode = 1;
}

/** Template do system.md de customização (comentado, não-vazio — vira o guia inicial do usuário). */
function systemTemplate(scope) {
  const alvo =
    scope === "global"
      ? "TODOS os projetos (camada global, ~/.mukta/system.md)"
      : "ESTE projeto (camada de projeto, .mukta/system.md — tem precedência sobre a global)";
  return [
    `# Customização do Mukta Zero (system) — ${scope}`,
    "#",
    "# Este arquivo é anexado ao system prompt do Mukta Zero DEPOIS da identidade",
    `# base ("ground zero") do MZ. Vale para ${alvo}.`,
    "# A ordem é: ground-zero do MZ → global (~/.mukta) → projeto (.mukta) → memória.",
    "# A camada mais específica refina/sobrepõe a anterior — igual ao CLAUDE.md do Claude Code.",
    "#",
    "# Escreva abaixo as SUAS regras (descomente/edite os exemplos):",
    "#",
    "# - Responda sempre em português técnico, direto, sem preâmbulo.",
    "# - Este projeto usa React + Vite + TypeScript; siga os padrões existentes em src/.",
    "# - Nunca proponha `git push --force` ou reset --hard sem eu pedir explicitamente.",
    "# - Prefira Edits cirúrgicos a reescrever arquivos inteiros.",
    "",
  ].join("\n");
}

const MEMORY_TEMPLATE = [
  "# Exemplo de memória do Mukta Zero",
  "#",
  "# Cada arquivo .md deste diretório é injetado como CONTEXTO PERSISTENTE no",
  "# system prompt (igual à memória do Claude Code). Guarde aqui fatos estáveis",
  "# que o MZ deve sempre saber sobre você/o projeto.",
  "# Apague este exemplo quando adicionar os seus.",
  "#",
  "# Ex.: O deploy do front é trunk-based — todo commit vai direto para main.",
  "",
].join("\n");

/**
 * `mz init [--global]` — cria os arquivos LOCAIS de customização do Mukta Zero
 * (system.md + memory/), estilo `/init` do Claude Code. NÃO-DESTRUTIVO: nunca
 * sobrescreve um arquivo existente (preserva a customização do usuário).
 * Default = projeto (.mukta/ no cwd). `--global` = ~/.mukta/.
 */
function cmdInit(args) {
  const scope = args.global && !args.project ? "global" : "project";
  const paths = personaPaths(process.cwd());
  const systemPath = scope === "global" ? paths.globalSystem : paths.projectSystem;
  const memoryDir = scope === "global" ? paths.globalMemory : paths.projectMemory;

  const created = [];
  const skipped = [];
  const ensureFile = (filePath, content) => {
    if (existsSync(filePath)) {
      skipped.push(filePath);
      return;
    }
    writeFileSync(filePath, content, "utf8");
    created.push(filePath);
  };

  try {
    mkdirSync(dirname(systemPath), { recursive: true });
    mkdirSync(memoryDir, { recursive: true });
  } catch (err) {
    console.error(`Erro ao criar diretorios de customizacao: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  ensureFile(systemPath, systemTemplate(scope));
  ensureFile(join(memoryDir, "example.md"), MEMORY_TEMPLATE);

  console.log(`Mukta Zero: customizacao ${scope} inicializada.`);
  for (const f of created) console.log(`  criado:    ${f}`);
  for (const f of skipped) console.log(`  ja existe: ${f} (preservado)`);
  console.log(
    `\nEdite ${systemPath} para ajustar a persona/regras do MZ. ` +
      "As mudancas entram no proximo 'mz ask'/'mz agent'."
  );
  process.exitCode = 0;
}

/**
 * `mz target <sub>` — aponta o app para uma INSTÂNCIA própria (não-Supabase),
 * persistente e NÃO-DESTRUTIVO (~/.mukta/target.json). Precedência: env MZ_* >
 * target.json > hospedado. `mz target clear` volta ao hospedado.
 * Sub: set --url <kong> --key <anon> [--runtime <url>] | show | clear.
 */
function cmdTarget(args) {
  const sub = args._[0];

  if (sub === "set") {
    if (!args.url || !args.key) {
      console.error("Uso: mz target set --url <kong-url> --key <anon_key> [--runtime <url>]");
      process.exitCode = 1;
      return;
    }
    try {
      const t = setTarget({ url: args.url, runtimeUrl: args.runtime || args.url, anonKey: args.key });
      console.log(`target salvo em ${targetPath()}`);
      console.log(`  supabase_url:     ${t.supabase_url}`);
      console.log(`  runtime_base_url: ${t.runtime_base_url}`);
      console.log("Faça `mz login <user>` na instância. `mz target clear` volta ao hospedado.");
    } catch (err) {
      console.error(`Erro: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (sub === "show") {
    const t = loadTarget();
    console.log(`alvo em uso: ${ACTIVE_TARGET_KIND}`);
    console.log(`  auth (SUPABASE_URL):   ${SUPABASE_URL}`);
    console.log(`  runtime (functions):   ${COMPANION_RUNTIME_BASE_URL}`);
    if (!t) console.log("(sem target.json — usando o hospedado padrão, salvo override por env MZ_*)");
    return;
  }

  if (sub === "clear") {
    const removed = clearTarget();
    console.log(removed ? "target removido — voltou ao hospedado padrão." : "(não havia target configurado)");
    return;
  }

  console.error(
    "Uso: mz target <set|show|clear>\n" +
      "  mz target set --url <kong-url> --key <anon_key> [--runtime <url>]\n" +
      "  mz target show\n" +
      "  mz target clear"
  );
  process.exitCode = 1;
}

/**
 * `mz plan "<objetivo>"` — o PLANEJADOR multi-etapas do MZ: decompõe um objetivo amplo em passos,
 * executa as folhas (build/agent, cyber-gated) com verificação por passo + gate HPX + replan, e PARA
 * nos passos privilegiados (deploy/DNS/commit/infra) p/ aprovação humana. Estado em ~/.mukta/plans/.
 * Flags: --dry-run (só decompõe), --approve-privileged (autoriza os passos privilegiados).
 */
async function cmdPlan(args) {
  const goal = args._[0];
  if (!goal) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  const auth = await restoreClient();
  if (!auth) {
    console.error("Not logged in (or session expired/invalid). Run: mz login <username>");
    process.exitCode = 1;
    return;
  }
  try {
    const companyId = await resolveCompany(auth.client, args.company || null);
    const agentId = await resolveAgent(auth.client, companyId, args.agent || null);

    console.log(`PLAN: ${goal}\nDecompondo o objetivo...`);
    const dec = await decomposeGoal(auth, { goal, agentId, companyId });
    if (!dec.ok) {
      console.error(`Decompose falhou: ${dec.error}`);
      process.exitCode = 1;
      return;
    }

    console.log(`\n── PLANO (${dec.steps.length} passos) ──`);
    dec.steps.forEach((s, idx) => {
      const deps = Array.isArray(s.deps) && s.deps.length ? ` · deps:${s.deps.join(",")}` : "";
      console.log(`  ${idx + 1}. [${s.id}] ${s.title} · ${s.action}${s.privileged ? " (PRIVILEGIADO)" : ""}${deps}`);
      if (s.out) console.log(`       out: ${s.out}`);
      if (s.dod) console.log(`       dod: ${s.dod}`);
    });

    if (args.dryRun) {
      console.log("\n[--dry-run] plano gerado, sem executar.");
      return;
    }

    const slug = `plan-${Date.now().toString(36)}`;
    const approve = async (step) => {
      if (args.approvePrivileged) {
        console.log(`  [--approve-privileged] passo privilegiado autorizado: ${step.id}`);
        return true;
      }
      return false;
    };

    const res = await executePlan(auth, { slug, goal, steps: dec.steps, agentId, companyId, approve });

    console.log(`\n── RESULTADO ── entregue=${res.delivered}`);
    for (const s of res.steps) console.log(`  [${s.status}] ${s.id} ${s.title}${s.detail ? ` — ${s.detail}` : ""}`);
    if (res.pendingApproval && res.pendingApproval.length) {
      console.log(`\n${res.pendingApproval.length} passo(s) PRIVILEGIADO(s) aguardando você (deploy/DNS/commit/infra):`);
      for (const s of res.pendingApproval) console.log(`  • ${s.title}: ${s.spec}`);
      console.log("Revise e, se ok, rode de novo com --approve-privileged (ou execute-os você mesmo).");
    }
    process.exitCode = res.delivered ? 0 : 1;
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

/**
 * `mz loop "<objetivo>"` — roda o PLANEJADOR em LOOP auto-pautado até uma condição.
 * Motor: runLoop() (loop.mjs, autorado pelo próprio MZ). Cada iteração decompõe+executa o
 * objetivo; para quando --until <cmd> sai 0, OU o plano entrega, OU --times N, OU o teto.
 * Flags: --times N, --interval Ns, --until "<cmd>", --approve-privileged.
 */
async function cmdLoop(args) {
  const goal = args._[0];
  if (!goal) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  const auth = await restoreClient();
  if (!auth) {
    console.error("Not logged in (or session expired/invalid). Run: mz login <username>");
    process.exitCode = 1;
    return;
  }
  const times = args.times ? Number(args.times) : Infinity;
  const intervalMs = args.interval ? Number(args.interval) * 1000 : 0;
  const untilCmd = args.until || null;
  try {
    const companyId = await resolveCompany(auth.client, args.company || null);
    const agentId = await resolveAgent(auth.client, companyId, args.agent || null);
    console.log(`LOOP: ${goal}${untilCmd ? ` (até: ${untilCmd})` : ""}${Number.isFinite(times) ? ` (max ${times}x)` : ""}`);

    const res = await runLoop({
      times,
      intervalMs,
      maxIterations: 50,
      log: (m) => console.log(`  [loop] ${m}`),
      iterate: async (i) => {
        console.log(`\n═══ iteração ${i} ═══`);
        const dec = await decomposeGoal(auth, { goal, agentId, companyId });
        if (!dec.ok) {
          console.error(`  decompose falhou: ${dec.error}`);
          return { delivered: false };
        }
        const slug = `loop-${Date.now().toString(36)}-${i}`;
        const r = await executePlan(auth, {
          slug,
          goal,
          steps: dec.steps,
          agentId,
          companyId,
          approve: async () => Boolean(args.approvePrivileged),
        });
        return { delivered: r.delivered };
      },
      shouldStop: async (i, last) => {
        if (untilCmd) {
          try {
            execSync(untilCmd, { stdio: ["ignore", "ignore", "ignore"], timeout: 60_000 });
            return true; // exit 0 → condição atingida
          } catch {
            return false;
          }
        }
        return Boolean(last && last.delivered);
      },
    });

    console.log(`\n── LOOP fim ── iterações=${res.iterations} · parou=${res.stopped}`);
    process.exitCode = 0;
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

/**
 * `mz workflow "<t1>" "<t2>" ...` — orquestração MULTI-TIMES: roda cada objetivo como um "time"
 * em PARALELO (pool de concorrência), cada um decompondo+executando seu próprio plano, e sintetiza.
 * Motor: runWorkflow() (workflow.mjs, autorado pelo próprio MZ). Flags: --concurrency N, --approve-privileged.
 */
async function cmdWorkflow(args) {
  const goals = args._.filter(Boolean);
  if (!goals.length) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  const auth = await restoreClient();
  if (!auth) {
    console.error("Not logged in (or session expired/invalid). Run: mz login <username>");
    process.exitCode = 1;
    return;
  }
  const concurrency = args.concurrency ? Number(args.concurrency) : 4;
  try {
    const companyId = await resolveCompany(auth.client, args.company || null);
    const agentId = await resolveAgent(auth.client, companyId, args.agent || null);
    console.log(`WORKFLOW: ${goals.length} time(s) em paralelo (concorrência ${concurrency})`);

    const out = await runWorkflow({
      items: goals,
      concurrency,
      log: (m) => console.log(`  [wf] ${m}`),
      run: async (goal, idx) => {
        const dec = await decomposeGoal(auth, { goal, agentId, companyId });
        if (!dec.ok) return { goal, ok: false, error: dec.error };
        const slug = `wf-${Date.now().toString(36)}-${idx}`;
        const r = await executePlan(auth, {
          slug,
          goal,
          steps: dec.steps,
          agentId,
          companyId,
          approve: async () => Boolean(args.approvePrivileged),
        });
        return { goal, ok: r.delivered, steps: (r.steps || []).length };
      },
      synthesize: async (results) => {
        const arr = Array.isArray(results) ? results : [];
        return { total: arr.length, delivered: arr.filter((r) => r && r.ok).length };
      },
    });

    // runWorkflow devolve { results, synthesized } quando há synthesize (senão o array cru).
    const results = Array.isArray(out) ? out : out.results || [];
    const syn = (out && out.synthesized) || { total: results.length, delivered: results.filter((r) => r && r.ok).length };
    console.log(`\n── WORKFLOW fim ── ${syn.delivered}/${syn.total} times entregues`);
    for (const r of results) {
      console.log(`  [${r && r.ok ? "ok" : "falhou"}] ${r && r.goal}${r && r.error ? ` — ${r.error}` : ""}`);
    }
    process.exitCode = syn.delivered === syn.total ? 0 : 1;
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

/**
 * `mz wake <sub>` — agendamento/retomada de trabalho multi-etapas. Persiste jobs em ~/.mukta/wakes/
 * (motor wake.mjs, autorado pelo próprio MZ) e retoma via o planejador. Sub:
 *   schedule "<objetivo>" [--at <ISO>] | list | resume <id> | run-due
 */
async function cmdWake(args) {
  const sub = args._[0];

  if (sub === "schedule") {
    const goal = args._[1];
    if (!goal) {
      console.error('Uso: mz wake schedule "<objetivo>" [--at <ISO>]');
      process.exitCode = 1;
      return;
    }
    let resumeAt = null;
    if (args.at) {
      const t = Date.parse(args.at);
      if (!Number.isNaN(t)) resumeAt = t;
    }
    const job = saveWake({ goal, resumeAt });
    if (!job) {
      console.error("Falha ao salvar o wake.");
      process.exitCode = 1;
      return;
    }
    console.log(`wake agendado: ${job.id}${resumeAt ? ` (retoma em ${new Date(resumeAt).toISOString()})` : " (retomável já)"}`);
    return;
  }

  if (sub === "list") {
    const rows = listWakes();
    if (!rows.length) {
      console.log("(nenhum wake agendado)");
      return;
    }
    for (const j of rows) {
      console.log(`  ${j.id} · [${j.status}] ${j.goal}${j.resumeAt ? ` · retoma ${new Date(j.resumeAt).toISOString()}` : ""}`);
    }
    return;
  }

  if (sub === "resume" || sub === "run-due") {
    const auth = await restoreClient();
    if (!auth) {
      console.error("Not logged in (or session expired/invalid). Run: mz login <username>");
      process.exitCode = 1;
      return;
    }
    const companyId = await resolveCompany(auth.client, args.company || null);
    const agentId = await resolveAgent(auth.client, companyId, args.agent || null);
    const jobs = sub === "run-due" ? dueWakes(Date.now()) : [loadWake(args._[1])].filter(Boolean);
    if (!jobs.length) {
      console.log(sub === "run-due" ? "(nenhum wake vencido)" : "wake não encontrado");
      return;
    }
    for (const job of jobs) {
      console.log(`\n▶ retomando ${job.id}: ${job.goal}`);
      updateWake(job.id, { status: "running" });
      const dec = await decomposeGoal(auth, { goal: job.goal, agentId, companyId });
      if (!dec.ok) {
        updateWake(job.id, { status: "failed" });
        console.error(`  decompose falhou: ${dec.error}`);
        continue;
      }
      const r = await executePlan(auth, {
        slug: `wake-${job.id}`,
        goal: job.goal,
        steps: dec.steps,
        agentId,
        companyId,
        approve: async () => Boolean(args.approvePrivileged),
      });
      updateWake(job.id, { status: r.delivered ? "done" : "pending" });
      console.log(`  ${r.delivered ? "entregue ✓" : "parcial (segue pending)"}`);
    }
    return;
  }

  console.error(
    'Uso: mz wake <schedule|list|resume|run-due>\n' +
      '  mz wake schedule "<objetivo>" [--at <ISO>]\n' +
      "  mz wake list\n" +
      "  mz wake resume <id>\n" +
      "  mz wake run-due"
  );
  process.exitCode = 1;
}

/**
 * `mz state <create|list|approve>` — ESTADOS de execução especialistas (7b state-tuning).
 * Criados sob demanda; um estado aprovado que casa a tarefa entra automaticamente no `mz ask`,
 * aplicando sua persona via sealedSystem() (herda o contrato 7a — guardas não-burláveis).
 */
function cmdState(args) {
  const sub = args._[0];
  if (sub === "create") {
    const name = args._[1];
    if (!name || !args.persona) {
      console.error('uso: mz state create <name> --persona "<instruções>" [--desc "<>"] [--keywords "a,b,c"] [--approve]');
      process.exitCode = 1;
      return;
    }
    try {
      const st = saveState(
        { name, description: args.desc || "", persona: args.persona, entryKeywords: (args.keywords || "").split(",").map((s) => s.trim()).filter(Boolean), createdBy: "user" },
        { approve: Boolean(args.approve) },
      );
      console.log(`Estado "${st.name}" criado (status=${st.status}).` + (st.status !== "approved" ? ` Aprove com: mz state approve ${st.name}` : ""));
    } catch (e) { console.error("Erro:", e.message); process.exitCode = 1; }
    return;
  }
  if (sub === "list") {
    const states = listStates();
    if (!states.length) { console.log("Nenhum estado criado ainda."); return; }
    for (const s of states) {
      console.log(`${s.status === "approved" ? "✓" : "·"} ${s.name} — ${s.description || "(sem descrição)"} [keywords: ${(s.entryKeywords || []).join(", ") || "—"}]`);
    }
    return;
  }
  if (sub === "approve") {
    const name = args._[1];
    try { const st = approveState(name); console.log(`Estado "${st.name}" aprovado — agora entra automaticamente quando a tarefa casar.`); }
    catch (e) { console.error("Erro:", e.message); process.exitCode = 1; }
    return;
  }
  console.error("uso: mz state <create|list|approve> ...");
  process.exitCode = 1;
}

/**
 * `mz push <branch> -m "<msg>" [--file <f>...] [--pr] [--base <b>] [--allow-default] [--no-push]`
 * Eixo 2 (git-na-nuvem): commita as mudanças numa branch e pusha ao remoto (opcional PR via gh).
 * OUTWARD-facing — usa as credenciais git/gh do usuário. NUNCA --force; recusa main/master sem --allow-default.
 */
function cmdPush(args) {
  const branch = args._[0] || args.branch;
  if (!branch) {
    console.error('uso: mz push <branch> -m "<mensagem>" [--file <f>...] [--pr] [--base <b>] [--allow-default] [--no-push]');
    process.exitCode = 1;
    return;
  }
  try {
    const res = pushChanges({
      branch,
      message: args.message || `mz: ${branch}`,
      files: Array.isArray(args.file) ? args.file : null,
      allowDefault: Boolean(args.allowDefault),
      doPush: !args.noPush,
    });
    if (!res.committed) { console.log("Nada para commitar (working tree limpo / nada staged)."); return; }
    console.log(`Commitado ${res.sha.slice(0, 8)} na branch '${res.branch}'` + (res.pushed ? ` e pushado p/ ${res.remote}.` : " (sem push)."));
    if (args.pr && res.pushed) {
      const url = openPr({ branch, base: args.base || "main", title: args.message || branch });
      console.log(`PR aberto: ${url}`);
    }
  } catch (e) { console.error("Erro:", e.message); process.exitCode = 1; }
}

async function cmdAgent(args) {
  const task = args._[0];
  if (!task) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  const auth = await restoreClient();
  if (!auth) {
    console.error(
      "Not logged in (or session expired/invalid). O agente PRECISA da sua conta " +
        "(JWT) — nunca roda com service-role. Run: mz login <username>"
    );
    process.exitCode = 1;
    return;
  }
  try {
    const companyId = await resolveCompany(auth.client, args.company || null);
    const agentId = await resolveAgent(auth.client, companyId, args.agent || null);
    let files = Array.isArray(args.file) ? args.file : [];
    if (!files.length) {
      files = localize(task);
      if (!files.length) {
        console.error("Nenhum arquivo alvo localizado — passe --file <arquivo>.");
        process.exitCode = 1;
        return;
      }
    }
    console.log(`AGENT: ${task}`);
    console.log(`ARQUIVOS: ${files.join(", ")}`);
    if (args.test) console.log(`ORACULO: ${args.test}`);
    console.log("");
    const res = await agentLoop(auth, {
      task,
      files,
      testCmd: args.test || null,
      maxRounds: Number(args.max) || 3,
      agentId,
      companyId,
    });
    console.log(res.cyber_blocked ? "cyber-gate: BLOQUEOU em alguma rodada" : "cyber-gate: sem bloqueios");
    console.log(`aplicado=${res.applied} · teste-passou=${res.passed} · rodadas=${res.rounds}`);
    if (res.applied) {
      console.log("\n── DIFF (revisar antes do commit) ──");
      try {
        // execFileSync (argv, SEM shell) — evita injeção por path com metacaracteres ($(...)/backtick/aspas).
        console.log(execFileSync("git", ["diff", "--", ...files], { encoding: "utf8" }));
      } catch {}
      console.log("\n[gate humano] revise o diff acima antes de commitar.");
    }
    process.exitCode = !res.applied || (args.test && res.passed !== true) ? 1 : 0;
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

function cmdSearch(args) {
  const query = args._[0];
  if (!query || query.startsWith("--")) { printUsage(); process.exitCode = 1; return; }
  const base = args.path || process.cwd();
  if (!existsSync(base)) { console.error("Path não encontrado: " + base); process.exitCode = 1; return; }
  const { engine, matches } = searchProject(query, { cwd: base, regex: !args.fixed, maxResults: args.max ? Number(args.max) : 100 });
  if (args.json) {
    console.log(JSON.stringify({ ok: true, query, base, engine, count: matches.length, matches }, null, 2));
  } else {
    for (const m of matches) console.log(m.file + ":" + m.line + ": " + m.text.slice(0, 200));
    console.error(matches.length + " resultado(s) · motor " + engine + " · " + base);
  }
  process.exitCode = matches.length ? 0 : 1;
}

function cmdHistory(args) {
  const sub = args._[0];
  if (sub === "sessions") {
    const rows = listSessions();
    if (args.json) { console.log(JSON.stringify(rows, null, 2)); return; }
    if (!rows.length) { console.log("Nenhuma sessão registrada."); return; }
    console.log("Sessões (abas) conhecidas:");
    for (const r of rows) console.log("  " + (r.label || r.key) + "  ·  " + (r.updated_at || "?") + "  ·  " + (r.workspace || ""));
    return;
  }
  if (sub === "show") {
    const rec = getRun(args._[1]);
    if (!rec) { console.error("Run não encontrado: " + args._[1]); process.exitCode = 1; return; }
    console.log(JSON.stringify(rec, null, 2));
    return;
  }
  const runs = listRuns(30);
  if (args.json) { console.log(JSON.stringify(runs, null, 2)); return; }
  if (!runs.length) { console.log("Sem histórico em " + sessionLabel() + ". Rode alguns comandos."); return; }
  console.log("Histórico · sessão " + sessionLabel() + " (" + runs.length + " recentes):");
  for (const r of runs) {
    const t = String(r.ts || "").replace("T", " ").slice(0, 19);
    const ok = r.exit === 0 ? "ok " : "err";
    const inp = r.input ? "  \"" + String(r.input).slice(0, 48) + "\"" : "";
    console.log("  " + r.id + "  " + t + "  [" + ok + "]  " + r.command + inp + "  (" + r.ms + "ms)");
  }
}

function cmdLogout() {
  const id = localIdentity();
  if (id && id.source === "env") {
    console.error("MZ_ACCESS_TOKEN está setado no ambiente — logout não remove env vars.");
    console.error("Para deslogar esta sessão: remova/unset MZ_ACCESS_TOKEN do ambiente.");
    process.exitCode = 1;
    return;
  }
  const removed = clearSession();
  if (removed.length === 0) console.log(`Nenhuma sessão ativa em ${sessionLabel()}.`);
  else console.log(`Deslogado de ${sessionLabel()} (removido: ${removed.join(", ")}).`);
}

function cmdWhoami(args) {
  const id = localIdentity();
  if (!id || id.expired) {
    const label = sessionLabel();
    if (args.json) console.log(JSON.stringify({ ok: false, logged_in: false, session: label, expired: !!(id && id.expired) }, null, 2));
    else console.log(`Não logado${id && id.expired ? " (sessão expirada)" : ""} · sessão ${label}. Rode: mz login <user>`);
    process.exitCode = 1;
    return;
  }
  const out = { ok: true, logged_in: true, session: id.label, source: id.source, user: id.username || id.sub || null, sub: id.sub || null, expires_at: id.exp ? new Date(id.exp * 1000).toISOString() : null };
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`Logado como ${id.username || id.sub || "?"} (${id.source}) · sessão ${id.label}${id.exp ? " · expira " + new Date(id.exp * 1000).toISOString() : ""}`);
}

/**
 * `mz` (sem argumentos) / `mz tui` — abre a JANELA ÚNICA: abas de execução,
 * `@` para arquivos, `+` para anexos, `/` para comandos e Shift+Tab para o modo.
 * Precisa de TTY: num pipe/CI cai no uso de linha de comando, que é o caminho
 * scriptável (e é o que os testes e o CI exercitam).
 */
async function cmdTui(args) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("A janela do mz precisa de um terminal interativo (TTY). Use os comandos: mz help");
    process.exitCode = 1;
    return;
  }
  const { startTui } = await import("./ui/app.mjs");
  await startTui({ mode: args.mode || null });
}

async function main() {
  const [, , command, ...rest] = process.argv;

  // Handle --version as a top-level flag (before command parsing)
  if (command === "--version" || command === "-v") {
    cmdVersion();
    return;
  }

  // Handle help flags: mz help, mz --help, mz -h
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(banner());
    printHelp();
    process.exitCode = 0;
    return;
  }

  // Sem comando: num terminal, `mz` ABRE A JANELA (padrão de mercado — o
  // caminho interativo é o default, os subcomandos ficam para script/CI).
  if (!command) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      await cmdTui(parseArgs(rest));
      return;
    }
    console.error(banner());
    printUsage();
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(rest);
  if (args.session) process.env.MZ_SESSION = String(args.session);

  // Observabilidade: registra cada run substantivo no histórico da sessão (append no exit).
  const HISTLESS = new Set(["help", "version", "history", "whoami"]);
  if (command && !HISTLESS.has(command)) {
    const _t0 = Date.now();
    const _input = args._[0] ? String(args._[0]).slice(0, 200) : null;
    process.on("exit", () => {
      try { recordRun({ command, input: _input, exit: process.exitCode || 0, ms: Date.now() - _t0, json: !!args.json, session: sessionLabel() }); } catch { /* histórico best-effort */ }
    });
  }

  if (command === "login") {
    await cmdLogin(args);
    return;
  }
  if (command === "auth") {
    await cmdAuth();
    return;
  }
  if (command === "logout") {
    cmdLogout();
    return;
  }
  if (command === "whoami") {
    cmdWhoami(args);
    return;
  }
  if (command === "history") {
    cmdHistory(args);
    return;
  }
  if (command === "search") {
    cmdSearch(args);
    return;
  }
  if (command === "ask") {
    await cmdAsk(args);
    return;
  }
  if (command === "review") {
    await cmdReview(args);
    return;
  }
  if (command === "build") {
    await cmdBuild(args);
    return;
  }
  if (command === "patch") {
    await cmdPatch(args);
    return;
  }
  if (command === "version" || command === "-v") {
    cmdVersion();
    return;
  }
  if (command === "agent") {
    await cmdAgent(args);
    return;
  }
  if (command === "config") {
    cmdConfig(args);
    return;
  }
  if (command === "init") {
    cmdInit(args);
    return;
  }
  if (command === "target") {
    cmdTarget(args);
    return;
  }
  if (command === "plan") {
    await cmdPlan(args);
    return;
  }
  if (command === "loop") {
    await cmdLoop(args);
    return;
  }
  if (command === "workflow") {
    await cmdWorkflow(args);
    return;
  }
  if (command === "wake") {
    await cmdWake(args);
    return;
  }
  if (command === "state") {
    cmdState(args);
    return;
  }
  if (command === "push") {
    cmdPush(args);
    return;
  }
  if (command === "falhas") {
    await cmdFalhas(args);
    return;
  }
  if (command === "tui" || command === "chat") {
    await cmdTui(args);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main();
