#!/usr/bin/env node
// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli `build` E2E oracle — REAL, non-mocked. Exercises
 * src/build.mjs directly against the live Mukta Zero backend and a real
 * local Python execution sandbox:
 *
 *  (a) GEN+TEST — an easy spec ("sum of even numbers in a list") + a real
 *      pytest file with 3 asserts, run through buildLoop(). This is the
 *      execution ORACLE: it asserts the review did not block AND the code
 *      actually passed the test when run for real (not a model's
 *      self-report) — direct one-shot generation, self-repair only kicks in
 *      if the first attempt fails the real test.
 *  (b) REVIEW-GATE — reviewGenerated() directly, over a known SQLi-by-
 *      concatenation snippet. Deterministic (offline gate, no network),
 *      asserts blocked === true. This is the safety property buildLoop()
 *      depends on: review always runs before any execution.
 *  (c) NO-TEST — buildLoop() without --test: asserts the returned code is
 *      non-empty and that the review step ran (tested stays false/null).
 *
 * Run from the repo root:
 *   node mz-cli/test/e2e-build.mjs
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { createAuthedClient } from "../src/auth.mjs";
import { resolveCompany, resolveAgent } from "../src/api.mjs";
import { buildLoop, reviewGenerated } from "../src/build.mjs";

/** Mirrors loadCredentials() from test/e2e.mjs / test/e2e-review.mjs. */
function loadCredentials() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const settingsPath = path.resolve(scriptDir, "../../.claude/settings.local.json");

  let automation = {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    automation = parsed.automation || {};
  } catch {
    automation = {};
  }

  const username = String(
    process.env.COMPANION_ADMIN_USERNAME ||
      process.env.PLAYWRIGHT_USERNAME ||
      automation.username ||
      ""
  ).trim();
  const password = String(
    process.env.COMPANION_ADMIN_PASSWORD ||
      process.env.PLAYWRIGHT_PASSWORD ||
      automation.password ||
      ""
  ).trim();

  return { username, password };
}

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

// Known SQLi-by-concatenation snippet (same shape as test/e2e-review.mjs'
// VULN_SOURCE) — used to assert the offline gate blocks BEFORE any
// execution, independent of what the live model generates.
const SQLI_SNIPPET = [
  "function getUserById(req, db) {",
  '  const q = "select * from users where id = " + req.query.id;',
  "  return db.query(q);",
  "}",
].join("\n");

const SUM_EVENS_SPEC =
  "Escreva uma funcao chamada sum_of_evens(numbers) que recebe uma lista de " +
  "inteiros e retorna a soma dos elementos pares (inclua pares negativos). " +
  "Nao use bibliotecas externas.";

const SUM_EVENS_TEST_PY = [
  "from solution import sum_of_evens",
  "",
  "def test_basic():",
  "    assert sum_of_evens([1, 2, 3, 4, 5, 6]) == 12",
  "",
  "def test_empty():",
  "    assert sum_of_evens([]) == 0",
  "",
  "def test_negative_even_counts():",
  "    assert sum_of_evens([-2, 1, 3, 4]) == 2",
  "",
].join("\n");

const PALINDROME_SPEC =
  "Escreva uma funcao chamada is_palindrome(s) que retorna True se a string " +
  "for um palindromo (ignorando maiusculas/minusculas e espacos), False caso " +
  "contrario.";

async function main() {
  const { username, password } = loadCredentials();
  if (!username || !password) {
    console.error(
      "No automation credentials found. Set .claude/settings.local.json " +
        "automation.username/password, or COMPANION_ADMIN_USERNAME/PASSWORD, " +
        "or PLAYWRIGHT_USERNAME/PASSWORD."
    );
    process.exit(1);
  }

  let auth = null;
  let companyId = null;
  let agentId = null;
  try {
    auth = await createAuthedClient(username, password);
    companyId = await resolveCompany(auth.client, null);
    agentId = await resolveAgent(auth.client, companyId, null);
  } catch (err) {
    console.error(`Setup failed (login/company/agent resolution): ${err.message}`);
    process.exit(1);
  }

  // (b) REVIEW-GATE — deterministic, offline, no network. The property
  // buildLoop() relies on: review always runs, and blocks BEFORE execution.
  const gateReview = reviewGenerated(SQLI_SNIPPET, "fixture-sqli.js");
  record(
    "REVIEW-GATE (SQLi snippet -> blocked before any execution)",
    gateReview.blocked === true,
    `blocked=${gateReview.blocked} verdict=${gateReview.verdict} findings=${JSON.stringify(
      gateReview.findings.map((f) => f.cwe || f.rule)
    )}`
  );

  // (a) GEN+TEST — real one-shot generation, real pytest execution oracle.
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "mz-build-e2e-"));
  const testFilePath = path.join(tmpDir, "test_solution.py");
  writeFileSync(testFilePath, SUM_EVENS_TEST_PY, "utf8");

  let genTestResult = null;
  try {
    genTestResult = await buildLoop(auth, {
      spec: SUM_EVENS_SPEC,
      lang: "py",
      testFile: testFilePath,
      agentId,
      companyId,
      maxRepair: 2,
    });
    const ok =
      Boolean(genTestResult) &&
      genTestResult.blockedByReview !== true &&
      genTestResult.tested === true &&
      genTestResult.passed === true;
    record(
      "GEN+TEST (easy spec, real pytest oracle -> passed)",
      ok,
      `attempts=${genTestResult?.attempts} passed=${genTestResult?.passed} ` +
        `blockedByReview=${genTestResult?.blockedByReview === true} ` +
        `reviewVerdict=${genTestResult?.review?.verdict}`
    );
  } catch (err) {
    record("GEN+TEST (easy spec, real pytest oracle -> passed)", false, err.message);
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  // (c) NO-TEST — simple build without --test: non-empty code + review ran.
  let noTestResult = null;
  try {
    noTestResult = await buildLoop(auth, {
      spec: PALINDROME_SPEC,
      lang: "py",
      testFile: null,
      agentId,
      companyId,
      maxRepair: 2,
    });
    const ok =
      Boolean(noTestResult) &&
      typeof noTestResult.code === "string" &&
      noTestResult.code.trim().length > 0 &&
      noTestResult.review !== null;
    record(
      "NO-TEST (simple build -> non-empty code + review ran)",
      ok,
      `codeLen=${(noTestResult?.code || "").length} reviewVerdict=${noTestResult?.review?.verdict} ` +
        `blockedByReview=${noTestResult?.blockedByReview === true}`
    );
  } catch (err) {
    record("NO-TEST (simple build -> non-empty code + review ran)", false, err.message);
  }

  const passCount = results.filter((r) => r.pass).length;
  console.log(`\nBUILD-E2E: ${passCount}/${results.length} PASS`);
  if (genTestResult) {
    console.log(
      `  GEN+TEST detail: attempts=${genTestResult.attempts}/3 passed=${genTestResult.passed} ` +
        `(self-repair used: ${genTestResult.attempts > 1 ? "yes" : "no"})`
    );
  }

  // Exit 0 only if the essential asserts pass: the review-gate (safety) and
  // the tested generation (the actual codegen oracle). NO-TEST is informative.
  const essential = results.filter(
    (r) => r.name.startsWith("REVIEW-GATE") || r.name.startsWith("GEN+TEST")
  );
  const essentialOk = essential.length > 0 && essential.every((r) => r.pass);
  process.exit(essentialOk ? 0 : 1);
}

main();
