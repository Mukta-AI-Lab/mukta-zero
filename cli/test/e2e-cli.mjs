// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// mz-cli/test/e2e-cli.mjs — E2E do CAMINHO REAL DO CLI (o binário), não só as funções-núcleo.
// Os outros E2E (e2e.mjs/e2e-review/e2e-agent) chamam createAuthedClient/agentLoop DIRETO — por isso a it.21
// quebrou o `mz agent` (dropado do index.mjs) SEM nenhum teste falhar. Este exercita: `mz login` (senha piped) →
// a sessão persiste → restoreClient → cada COMANDO responde pelo caminho real (execFileSync node index.mjs).
// Uso: node mz-cli/test/e2e-cli.mjs   (creds: .claude/settings.local.json automation.*)
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(dir, "..", "..");
const CLI = path.join(dir, "..", "src", "index.mjs");
const SESSION = path.join(os.homedir(), ".mukta", "session.json");

function creds() {
  const s = JSON.parse(readFileSync(path.join(REPO, ".claude", "settings.local.json"), "utf8"));
  const a = s.automation || {};
  const username = process.env.PLAYWRIGHT_USERNAME || a.username;
  const password = process.env.PLAYWRIGHT_PASSWORD || a.password;
  if (!username || !password) throw new Error("sem credenciais de automação (.claude/settings.local.json automation.*)");
  return { username, password };
}
// roda o BINÁRIO do CLI; retorna {ok, out, code}
function cli(args, input) {
  try { const out = execFileSync("node", [CLI, ...args], { cwd: REPO, encoding: "utf8", input, timeout: 90000, stdio: ["pipe", "pipe", "pipe"] }); return { ok: true, out, code: 0 }; }
  catch (e) { return { ok: false, out: (e.stdout || "") + (e.stderr || e.message || ""), code: e.status ?? 1 }; }
}

let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { console.log(`PASS: ${name}`); pass++; } else { console.error(`FAIL: ${name} — ${detail || ""}`); fail++; } };

(async () => {
  // 0) comandos sem-auth pelo binário (pega drop de roteamento — a classe de bug da it.21/22)
  const v = cli(["version"]);
  check("mz version (binário)", v.ok && /\d+\.\d+\.\d+/.test(v.out), `code=${v.code} out=${JSON.stringify(v.out.slice(0, 60))}`);
  const h = cli(["help"]);
  check("mz help lista todos os comandos", h.ok && ["login", "ask", "review", "build", "version", "agent"].every((c) => h.out.includes(c)), `out=${JSON.stringify(h.out.slice(0, 120))}`);

  // 1) LOGIN pelo binário (senha piped COM newline) → sessão persiste
  const { username, password } = creds();
  const lg = cli(["login", username], password + "\n");
  check("mz login (binário, senha piped) persiste a sessão", lg.ok && existsSync(SESSION) && /Logged in/i.test(lg.out), `code=${lg.code} out=${JSON.stringify(lg.out.slice(0, 100))}`);

  // 2) o CAMINHO CRÍTICO: `mz ask` usa restoreClient (o caminho que a it.21 quebrou sem alarme)
  const ak = cli(["ask", "Responda com a unica palavra: pong"]);
  check("mz ask via restoreClient (caminho real do CLI)", ak.ok && ak.out.trim().length > 0 && !/Not logged in/i.test(ak.out), `code=${ak.code} out=${JSON.stringify(ak.out.slice(0, 120))}`);

  console.log(`\nCLI-E2E: ${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e && e.message); process.exit(1); });
