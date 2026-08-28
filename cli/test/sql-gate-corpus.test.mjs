// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// Regressao do gate CWE-89 (mao local, offline): corpus adversarial (safe tagged-template vs injecao real).
// Falha (exit 1) se algum FALSO-POSITIVO (safe marcado) ou FALSO-NEGATIVO (injecao nao pega).
// Corpus gerado pelo Workflow gapc-sql-gate-adversarial (24 safe / 22 unsafe). Guard: node mz-cli/test/sql-gate-corpus.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cyberGate } from "../vendor/cyber-gate.mjs";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(__dir, "sql-gate-corpus.json"), "utf8"));
const has89 = (src) => (cyberGate(src, { filename: "t.ts" }).findings || []).some((f) => f.cwe === "CWE-89");
const FP = [], FN = [];
for (const c of cases) { const got = has89(c.code); if (got === c.expect_flag) continue; (c.expect_flag ? FN : FP).push(c); }
console.log(`sql-gate-corpus: ${cases.length} casos | FP ${FP.length} | FN ${FN.length}`);
for (const c of FP) console.log("  FP (safe marcado como injecao): " + c.name);
for (const c of FN) console.log("  FN (injecao real NAO pega): " + c.name);
if (FP.length || FN.length) { console.error("FALHOU — gate CWE-89 descalibrado"); process.exit(1); }
console.log("OK — 0 FP, 0 FN, gate CWE-89 calibrado");
