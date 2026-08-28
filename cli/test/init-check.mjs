// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// Oráculo do `mz init`: pelo BINÁRIO real, num cwd temporário (não toca no ~/.mukta do usuário).
// Verifica (1) scaffold cria .mukta/system.md + .mukta/memory/example.md; (2) NÃO-DESTRUTIVO: 2ª execução
// preserva o conteúdo editado pelo usuário e reporta "ja existe".
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(dir, "..", "src", "index.mjs");
let fail = 0;
const ck = (n, c, d) => { if (c) console.log(`PASS: ${n}`); else { console.error(`FAIL: ${n} — ${d || ""}`); fail++; } };
const run = (cwd) => { try { return { ok: true, out: execFileSync("node", [CLI, "init"], { cwd, encoding: "utf8" }) }; } catch (e) { return { ok: false, out: (e.stdout || "") + (e.stderr || e.message || "") }; } };

const tmp = mkdtempSync(path.join(os.tmpdir(), "mzinit-"));
const sysPath = path.join(tmp, ".mukta", "system.md");
const memPath = path.join(tmp, ".mukta", "memory", "example.md");

const r1 = run(tmp);
ck("mz init roda (exit 0)", r1.ok, r1.out.slice(0, 200));
ck("cria .mukta/system.md", existsSync(sysPath));
ck("cria .mukta/memory/example.md", existsSync(memPath));
ck("relata 'criado' na 1a execucao", /criado/.test(r1.out), r1.out.slice(0, 200));

// usuário edita o system.md → a 2ª execução NÃO pode sobrescrever
const sentinel = "MINHA REGRA CUSTOM — NAO SOBRESCREVER";
writeFileSync(sysPath, sentinel, "utf8");
const r2 = run(tmp);
ck("nao-destrutivo: preserva o system.md editado", readFileSync(sysPath, "utf8") === sentinel);
ck("relata 'ja existe' na 2a execucao", /ja existe/.test(r2.out), r2.out.slice(0, 200));

console.log(`\nINIT-CHECK: ${fail ? fail + " falha(s)" : "todos PASS"}`);
process.exit(fail ? 1 : 0);
