// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// Oráculo (SUPERVISOR): `mz help` deve sair 0 e listar todos os comandos. Login-free, determinístico.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const dir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(dir, "..", "src", "index.mjs");
let out = "";
try { out = execSync(`node "${cli}" help`, { encoding: "utf8" }); }
catch (e) { console.error("FAIL: `mz help` saiu com erro (exit != 0):", String(e.stdout || e.message).slice(0, 120)); process.exit(1); }
const need = ["login", "ask", "review", "build", "version"];
const missing = need.filter((c) => !out.toLowerCase().includes(c));
if (missing.length) { console.error("FAIL: `mz help` não lista:", missing.join(", "), "· saída:", JSON.stringify(out.slice(0, 150))); process.exit(1); }
console.log("HELP-CHECK PASS: `mz help` (exit 0) lista todos os comandos");
process.exit(0);
