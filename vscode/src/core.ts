// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview Thin TypeScript wrapper around the proven mz-cli core
 * (mz-cli/src/{auth,api,review}.mjs). This file owns ZERO auth/dispatch/
 * review logic of its own — it only adapts mz-cli's CLI-shaped functions
 * (which print to stdout/exit codes) into promise-returning functions an
 * editor extension can call and render.
 *
 * SECURITY: same hard rules as mz-cli (see mz-cli/src/auth.mjs,
 * mz-cli/src/config.mjs) — user JWT only (SUPABASE_PUBLISHABLE_KEY / anon
 * role + the user's own credentials), never SUPABASE_SERVICE_ROLE_KEY,
 * never X-Internal-Call. Tokens are never logged here either.
 */

import { execFileSync } from "node:child_process";
import {
  createAuthedClient,
  saveSession,
  restoreClient,
  loadRawSession,
} from "../../mz-cli/src/auth.mjs";
import { resolveCompany, resolveAgent, askAgent, extractResponseText } from "../../mz-cli/src/api.mjs";
import { localReview, cloudReview, combineReport } from "../../mz-cli/src/review.mjs";
import { agentLoop } from "../../mz-cli/src/agent.mjs";
import type { CombinedReportLike } from "./diagnostics";

export interface LoginResult {
  ok: boolean;
  username?: string;
  userId?: string;
  error?: string;
}

/** mz.login command core: authenticate + persist session (mirrors `mz login`). */
export async function runLogin(username: string, password: string): Promise<LoginResult> {
  try {
    const auth = await createAuthedClient(username, password);
    saveSession(username, auth.session);
    return { ok: true, username, userId: auth.userId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Cheap, synchronous "is there a session on disk" check — no network call. */
export function hasSession(): boolean {
  return Boolean(loadRawSession());
}

export interface SessionInfo {
  loggedIn: boolean;
  username: string | null;
}

/** Cheap, synchronous "who (if anyone) is logged in" check — no network call, mirrors hasSession(). */
export function getSessionInfo(): SessionInfo {
  const raw = loadRawSession() as { username?: string } | null;
  return { loggedIn: Boolean(raw), username: raw?.username ?? null };
}

export interface AskOptions {
  companyId?: string;
  agentId?: string;
}

export interface AskResult {
  ok: boolean;
  notLoggedIn?: boolean;
  text?: string;
  error?: string;
}

/** mz.ask command core: restore session, resolve tenant/agent, call run-agent-chat (mirrors `mz ask`). */
export async function runAsk(prompt: string, opts: AskOptions = {}): Promise<AskResult> {
  const auth = await restoreClient();
  if (!auth) {
    return { ok: false, notLoggedIn: true, error: "Not logged in (or session expired/invalid)." };
  }

  try {
    const companyId = await resolveCompany(auth.client, opts.companyId || null);
    const agentId = await resolveAgent(auth.client, companyId, opts.agentId || null);
    const result = await askAgent(auth, { prompt, agentId, companyId });

    if (!result.ok) {
      const message =
        (result.payload && result.payload.error && (result.payload.error.message || result.payload.error)) ||
        (result.rawText ? result.rawText.slice(0, 300) : `HTTP ${result.status}`);
      return { ok: false, error: `Request failed (HTTP ${result.status}): ${message}` };
    }

    return { ok: true, text: extractResponseText(result) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ReviewOptions {
  companyId?: string;
  agentId?: string;
  localOnly?: boolean;
}

export interface ReviewResult {
  ok: boolean;
  blocked: boolean;
  /** Human-readable report text, same as `mz review` stdout. */
  reportText: string;
  /** Parsed combined report (json mode) — feed to findingsToDiagnostics(). */
  combined: CombinedReportLike | null;
  notLoggedIn: boolean;
  cloudSkipped: boolean;
}

/**
 * mz.review command core: "mao local" (always, offline) + "cerebro nuvem"
 * (best-effort, needs a session) + combineReport() (mirrors `mz review`).
 * Never throws — degraded cloud states are folded into the returned report,
 * same contract as the CLI.
 */
export async function runReview(filePath: string, source: string, opts: ReviewOptions = {}): Promise<ReviewResult> {
  const local = localReview(source, filePath);

  let cloud: Awaited<ReturnType<typeof cloudReview>> | null = null;
  let notLoggedIn = false;

  if (!opts.localOnly) {
    const auth = await restoreClient();
    if (!auth) {
      notLoggedIn = true;
      cloud = {
        ok: false,
        chunked: 0,
        degraded: true,
        truncated: false,
        error: "not logged in",
        status: null,
        findings: [],
        summary: "",
        rawText: "",
      };
    } else {
      try {
        const companyId = await resolveCompany(auth.client, opts.companyId || null);
        const agentId = await resolveAgent(auth.client, companyId, opts.agentId || null);
        cloud = await cloudReview(auth, { source, filename: filePath, agentId, companyId });
      } catch (err) {
        cloud = {
          ok: false,
          chunked: 0,
          degraded: true,
          truncated: false,
          error: err instanceof Error ? err.message : String(err),
          status: null,
          findings: [],
          summary: "",
          rawText: "",
        };
      }
    }
  }

  const humanReport = combineReport(local, cloud, filePath, false);
  const jsonReport = combineReport(local, cloud, filePath, true);

  let combined: CombinedReportLike | null = null;
  try {
    combined = JSON.parse(jsonReport.text) as CombinedReportLike;
  } catch {
    combined = null;
  }

  return {
    ok: true,
    blocked: Boolean(humanReport.blocked),
    reportText: String(humanReport.text),
    combined,
    notLoggedIn,
    cloudSkipped: opts.localOnly === true,
  };
}

export interface AgentEditOptions {
  companyId?: string;
  agentId?: string;
  /** Real oracle command (e.g. a test file/command) run after each apply. Optional — without it, a single successful gate+apply is the whole loop. */
  testCmd?: string;
  maxRounds?: number;
  /** Repo root used to resolve `files` (repo-relative paths) and to run git commands. Defaults to process.cwd(). */
  cwd?: string;
}

export interface AgentEditResult {
  ok: boolean;
  notLoggedIn?: boolean;
  error?: string;
  applied: boolean;
  passed: boolean | null;
  rounds: number;
  files: string[];
  cyberBlocked: boolean;
  /** `git diff` over the applied files, for human review before committing. Empty if nothing was applied. */
  diffText: string;
}

/**
 * mz.agent command core: agentic self-edit loop over the given repo-relative
 * `files`, under the caller's OWN Mukta account (JWT) — mirrors `mz agent`.
 * Contains ZERO loop/gate logic of its own; it only adapts mz-cli's
 * agentLoop() (src/agent.mjs, which runs the offline cyber-gate on every
 * generated file BEFORE writing a byte to disk) into a promise the editor
 * extension can call and render.
 *
 * SECURITY: same hard rules as runAsk/runReview — user JWT only
 * (restoreClient()), never service-role. Never throws for a degraded/failed
 * loop — failures are folded into the returned result.
 */
export async function runAgentEdit(task: string, files: string[], opts: AgentEditOptions = {}): Promise<AgentEditResult> {
  const notLoggedInResult: AgentEditResult = {
    ok: false,
    notLoggedIn: true,
    error: "Not logged in (or session expired/invalid).",
    applied: false,
    passed: null,
    rounds: 0,
    files: [],
    cyberBlocked: false,
    diffText: "",
  };

  const auth = await restoreClient();
  if (!auth) return notLoggedInResult;

  const cwd = opts.cwd || process.cwd();

  try {
    const companyId = await resolveCompany(auth.client, opts.companyId || null);
    const agentId = await resolveAgent(auth.client, companyId, opts.agentId || null);

    const result = await agentLoop(auth, {
      task,
      files,
      testCmd: opts.testCmd || null,
      maxRounds: opts.maxRounds || 3,
      agentId,
      companyId,
      cwd,
    });

    const appliedFiles: string[] = Array.isArray(result.files) ? result.files : [];

    let diffText = "";
    if (result.applied && appliedFiles.length) {
      try {
        diffText = execFileSync("git", ["diff", "--", ...appliedFiles], { cwd, encoding: "utf8" });
      } catch (err) {
        diffText = `(nao foi possivel gerar diff: ${err instanceof Error ? err.message : String(err)})`;
      }
    }

    return {
      ok: true,
      applied: Boolean(result.applied),
      passed: result.passed === undefined ? null : result.passed,
      rounds: Number(result.rounds) || 0,
      files: appliedFiles,
      cyberBlocked: Boolean(result.cyber_blocked),
      diffText,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      applied: false,
      passed: null,
      rounds: 0,
      files: [],
      cyberBlocked: false,
      diffText: "",
    };
  }
}
