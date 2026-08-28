// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// Oráculo (SUPERVISOR): `mz -v` deve imprimir a versão (alias curto de version). Login-free, determinístico.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";
const dir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(dir, "..", "src", "index.mjs");
const ver = JSON.parse(readFileSync(path.join(dir, "..", "package.json"), "utf8")).version;
let out = "";
try { out = execSync(`node "${cli}" -v`, { encoding: "utf8" }); }
catch (e) { console.error("FAIL: `mz -v` erro/exit!=0:", String(e.stdout || e.message).slice(0,120)); process.exit(1); }
if (!out.includes(ver)) { console.error("FAIL: `mz -v` não imprimiu a versão", ver, "· saída:", JSON.stringify(out.slice(0,80))); process.exit(1); }
console.log("V-ALIAS PASS: `mz -v` imprimiu a versão", ver);
process.exit(0);
