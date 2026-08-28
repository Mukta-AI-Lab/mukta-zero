// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// Oráculo (DoD) do "modo self-build confiável": localReview isenta a regra child_process APENAS para o
// source do próprio mz-cli (infra confiável do MZ), mantendo a regra p/ código de produto e TODAS as
// outras regras (SQLi etc.). Guarda também os exports p/ pegar drop de código no whole-file rewrite.
import * as review from "../src/review.mjs";
import { localReview } from "../src/review.mjs";

let fail = 0;
const ck = (n, c) => { if (c) console.log("PASS:", n); else { console.error("FAIL:", n); fail++; } };
const isCP = (f) => /child_process/i.test([f.cwe, f.rule, f.message, f.why, f.id].filter(Boolean).join(" "));

const cpSrc = 'import { execSync } from "node:child_process";\nexport const h = () => execSync("ls");';
const sqliSrc = 'export function q(req){ return "select * from users where id = " + req.query.id; }';

ck("exports preservados (localReview/cloudReview/combineReport/extractJson)",
  ["localReview", "cloudReview", "combineReport", "extractJson"].every((f) => typeof review[f] === "function"));

// 1) child_process CONTINUA bloqueado em código de PRODUTO (path normal) — regra preservada p/ o usuário
const prod = localReview(cpSrc, "src/product/thing.ts");
ck("child_process flagrado em código de produto (path normal)", (prod.findings || []).some(isCP));

// 2) child_process ISENTO no source do próprio mz-cli (trusted self-build)
const self = localReview(cpSrc, "mz-cli/src/foo.mjs");
ck("child_process ISENTO no source do mz-cli (trusted)", !((self.findings || []).some(isCP)));

// 3) SQLi AINDA barrado no mz-cli (a isenção é CIRÚRGICA: só child_process, não tudo)
const sqli = localReview(sqliSrc, "mz-cli/src/foo.mjs");
ck("SQLi ainda flagrado no mz-cli (isenção cirúrgica)", (sqli.findings || []).length > 0);

console.log(fail ? `\nTRUSTED-MODE: ${fail} falha(s)` : "\nTRUSTED-MODE OK");
process.exit(fail ? 1 : 0);
