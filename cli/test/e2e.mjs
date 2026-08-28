#!/usr/bin/env node
// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli E2E oracle — REAL, non-mocked. Exercises the actual
 * CLI modules (src/auth.mjs, src/api.mjs) against the live Mukta Zero
 * backend: real login, real tenant/agent resolution under RLS, a real
 * run-agent-chat call, and a negative (no-auth -> 401) security check.
 *
 * Run from the repo root:
 *   node mz-cli/test/e2e.mjs
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAuthedClient } from "../src/auth.mjs";
import { resolveCompany, resolveAgent, askAgent, extractResponseText } from "../src/api.mjs";
import { RUN_AGENT_CHAT_URL, SUPABASE_PUBLISHABLE_KEY } from "../src/config.mjs";

/** Mirrors loadAutomationSettings() from scripts/_companion-harness-lib.mjs. */
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
  const line = `${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // 1. LOGIN
  try {
    auth = await createAuthedClient(username, password);
    const tokenParts = auth.session.access_token.split(".");
    const looksLikeJwt = tokenParts.length === 3;
    const { data: userData, error: userError } = await auth.client.auth.getUser();
    const ok = looksLikeJwt && !userError && !!userData?.user?.id;
    record("LOGIN", ok, ok ? `user_id=${userData.user.id}` : userError?.message || "invalid session");
    if (!ok) auth = null;
  } catch (err) {
    record("LOGIN", false, err.message);
    auth = null;
  }

  // 2. COMPANY
  let companyId = null;
  if (auth) {
    try {
      companyId = await resolveCompany(auth.client, null);
      const ok = UUID_RE.test(String(companyId || ""));
      record("COMPANY", ok, `company_id=${companyId}`);
      if (!ok) companyId = null;
    } catch (err) {
      record("COMPANY", false, err.message);
    }
  } else {
    record("COMPANY", false, "skipped (no auth)");
  }

  // 3. AGENT
  let agentId = null;
  if (auth && companyId) {
    try {
      agentId = await resolveAgent(auth.client, companyId, null);
      const ok = UUID_RE.test(String(agentId || ""));
      record("AGENT", ok, `agent_id=${agentId}`);
      if (!ok) agentId = null;
    } catch (err) {
      record("AGENT", false, err.message);
    }
  } else {
    record("AGENT", false, "skipped (no company)");
  }

  // 4. ASK (real run-agent-chat call, real runtime response — no fixtures)
  if (auth && companyId && agentId) {
    try {
      const result = await askAgent(auth, {
        prompt: "Responda com a única palavra: PONG",
        agentId,
        companyId,
      });
      const text = extractResponseText(result).trim();
      const ok = result.status === 200 && text.length > 0;
      const preview = (text || result.rawText || "").slice(0, 200);
      record("ASK", ok, `status=${result.status} body="${preview}"`);
    } catch (err) {
      record("ASK", false, err.message);
    }
  } else {
    record("ASK", false, "skipped (missing auth/company/agent)");
  }

  // 5. NEGATIVE — no Authorization header must be rejected (401)
  try {
    const response = await fetch(RUN_AGENT_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({
        messages: [{ role: "user", content: "x" }],
        agent_id: agentId || "00000000-0000-0000-0000-000000000000",
        company_id: companyId || "00000000-0000-0000-0000-000000000000",
      }),
    });
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    const ok = response.status === 401;
    record("NEGATIVE (no auth -> 401)", ok, `status=${response.status} body="${bodyText.slice(0, 150)}"`);
  } catch (err) {
    record("NEGATIVE (no auth -> 401)", false, err.message);
  }

  const passCount = results.filter((r) => r.pass).length;
  console.log(`E2E: ${passCount}/5 PASS`);
  process.exit(passCount === 5 ? 0 : 1);
}

main();
