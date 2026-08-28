// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// Oráculo (SUPERVISOR): `mz login <user>` com a senha piped SEM newline final deve LER a senha e TENTAR o login
// (falha por credencial inválida = "Login failed"), NÃO ler vazio ("Password required") nem travar.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const dir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(dir, "..", "src", "index.mjs");
// senha SEM \n final + usuário inexistente
const r = spawnSync("node", [cli, "login", "zzz_nouser_" + Date.now()], { input: "senha_de_teste_sem_newline", encoding: "utf8", timeout: 30000 });
const out = (r.stdout || "") + (r.stderr || "");
if (r.signal === "SIGTERM" || r.error) { console.error("FAIL: login travou/erro com stdin sem newline:", r.signal || r.error); process.exit(1); }
if (/Password required/i.test(out)) { console.error("FAIL: leu senha VAZIA (bug do readline sem newline). Saída:", JSON.stringify(out.slice(0,120))); process.exit(1); }
if (!/Login failed/i.test(out)) { console.error("FAIL: esperava 'Login failed' (tentou logar). Saída:", JSON.stringify(out.slice(0,150))); process.exit(1); }
console.log("LOGIN-STDIN PASS: senha piped sem newline foi LIDA e o login foi tentado");
process.exit(0);
