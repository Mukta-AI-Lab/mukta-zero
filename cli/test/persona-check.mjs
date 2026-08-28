// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// Oráculo: a persona do MZ é ground-zero PRÓPRIO (não a company) + customização local (system.md/memory), estilo Claude Code.
import { assembleSystem, MZ_GROUND_ZERO } from "../src/persona.mjs";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
let fail = 0;
const ck = (n, c) => { if (c) console.log(`PASS: ${n}`); else { console.error(`FAIL: ${n}`); fail++; } };

ck("ground-zero é identidade própria do MZ (não company)", MZ_GROUND_ZERO.includes("Mukta Zero") && /IGNORE.*(marketing|vendas)/i.test(MZ_GROUND_ZERO));
const base = assembleSystem({ cwd: path.join(os.tmpdir(), "mz_none_" + Date.now()) });
ck("sem customização = só ground-zero", base.trim() === MZ_GROUND_ZERO.trim());

const dir = path.join(os.tmpdir(), "mzpersona_" + Date.now());
mkdirSync(path.join(dir, ".mukta", "memory"), { recursive: true });
writeFileSync(path.join(dir, ".mukta", "system.md"), "Regra do projeto: responda em ingles tecnico.", "utf8");
writeFileSync(path.join(dir, ".mukta", "memory", "fato.md"), "O projeto usa Vitest.", "utf8");
const withProj = assembleSystem({ cwd: dir });
ck(".mukta/system.md do projeto é incluído", withProj.includes("responda em ingles tecnico"));
ck(".mukta/memory do projeto é incluída", withProj.includes("usa Vitest"));
ck("layering: ground-zero vem ANTES da customização do projeto", withProj.indexOf("Mukta Zero") < withProj.indexOf("responda em ingles"));
rmSync(dir, { recursive: true, force: true });

console.log(`\nPERSONA-CHECK: ${fail ? fail + " falha(s)" : "todos PASS"}`);
process.exit(fail ? 1 : 0);
