// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli api — tenant/agent resolution (under RLS, user JWT)
 * and the run-agent-chat entry point.
 *
 * HARD RULE: never send X-Internal-Call — that header requires a
 * service-role token server-side and is out of scope for a user-JWT CLI.
 */

import { RUN_AGENT_CHAT_URL, MZ_ASYNC_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.mjs";
import { refreshAuthContext } from "./auth.mjs";
import { enforceExecutionContract } from "./persona.mjs";

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST JSON autenticado contra uma edge function (user JWT + anon apikey), RESILIENTE a rede:
 * timeout (AbortController), retry+backoff em erro transitório (queda de rede/timeout/5xx/429).
 * NUNCA lança por falha de rede — devolve um resultado estruturado {ok:false,status:0,networkError}
 * p/ o caller tratar com uma mensagem clara (em vez de "unhandled rejection"/"Not logged in").
 * 4xx (incl. 401/403) NÃO é retry — sobe p/ o refresh de auth do caller.
 */
export async function invokeJsonEdge({ url, accessToken, body, headers = {}, retries = 2, timeoutMs = 90000 }) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
          ...headers,
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      const rawText = await response.text();
      if (TRANSIENT_STATUS.has(response.status) && attempt < retries) {
        await sleep(300 * 2 ** attempt + Math.floor(Math.random() * 200));
        continue;
      }
      let payload = null;
      try { payload = rawText ? JSON.parse(rawText) : null; } catch { payload = null; }
      return { ok: response.ok, status: response.status, payload, rawText };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e; // erro de REDE (fetch lançou) ou timeout (abort) — transitório
      if (attempt < retries) { await sleep(300 * 2 ** attempt + Math.floor(Math.random() * 200)); continue; }
    }
  }
  return { ok: false, status: 0, payload: null, rawText: "", networkError: String(lastErr?.message || lastErr || "rede indisponível") };
}

/**
 * Resolves the acting company_id under RLS:
 *  - explicitCompanyId given -> validated against the user's own memberships.
 *  - else if exactly 1 membership -> used automatically.
 *  - else -> throws (ambiguous, caller must pass --company).
 */
export async function resolveCompany(client, explicitCompanyId) {
  let companyIds = [];

  const rpcResult = await client.rpc("get_user_company_ids");
  if (!rpcResult.error && Array.isArray(rpcResult.data)) {
    companyIds = rpcResult.data.filter(Boolean);
  } else {
    const { data: rows, error } = await client
      .from("user_company_memberships")
      .select("company_id");
    if (error) {
      throw new Error(`Failed to resolve company memberships: ${error.message}`);
    }
    companyIds = [...new Set((rows || []).map((row) => row.company_id).filter(Boolean))];
  }

  if (companyIds.length === 0) {
    throw new Error("This user has no company memberships (user_company_memberships is empty).");
  }

  if (explicitCompanyId) {
    if (!companyIds.includes(explicitCompanyId)) {
      throw new Error(`Company ${explicitCompanyId} is not among this user's memberships.`);
    }
    return explicitCompanyId;
  }

  if (companyIds.length > 1) {
    throw new Error(
      `User belongs to ${companyIds.length} companies; pass --company <id>. Options: ${companyIds.join(", ")}`
    );
  }

  return companyIds[0];
}

/**
 * Resolves the acting agent_id under RLS:
 *  - explicitAgentId given -> validated (must belong to companyId).
 *  - else -> first active agent_profiles row for companyId.
 */
export async function resolveAgent(client, companyId, explicitAgentId) {
  if (explicitAgentId) {
    const { data, error } = await client
      .from("agent_profiles")
      .select("id")
      .eq("id", explicitAgentId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error || !data) {
      throw new Error(`Agent ${explicitAgentId} was not found for this company (or no access under RLS).`);
    }
    return data.id;
  }

  // Some agent_profiles rows have no model_id (or point at a retired
  // llm_models row) — run-agent-chat rejects those with EDGE_008
  // agent_model_not_configured. Prefer the first active agent that also has
  // a usable (is_active=true) model wired up.
  const { data, error } = await client
    .from("agent_profiles")
    .select("id, display_name, created_at, model_id, llm_models!agent_profiles_model_id_fkey ( is_active )")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to resolve agent: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error("No active agent (agent_profiles.is_active=true) found for this company.");
  }

  const withUsableModel = data.find(
    (row) => row.model_id && row.llm_models && row.llm_models.is_active === true
  );
  if (withUsableModel) return withUsableModel.id;

  // Fallback: no agent has a confirmed-active model — use the first active
  // agent anyway so callers get the real backend error rather than a CLI-side one.
  return data[0].id;
}

/**
 * Calls run-agent-chat with the user's JWT. On 401/403, refreshes the
 * session once and retries exactly one time.
 *
 * `systemPromptOverride` (optional) mirrors the pattern already used by
 * cloudReview()/generateCode() (src/review.mjs, src/build.mjs) to turn
 * whichever agent the company has configured into a purpose-built persona
 * for this one call — omit it for a plain chat turn.
 *
 * @param {object} authContext - live session (see src/auth.mjs restoreClient()/createAuthedClient()).
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} opts.agentId
 * @param {string} opts.companyId
 * @param {string|null} [opts.systemPromptOverride]
 */
/** Submete um job async ao mz-async (fire-and-forget server-side) com 1 refresh de auth em 401/403. */
async function submitAsyncJob(authContext, body) {
  const submit = (accessToken) => invokeJsonEdge({ url: MZ_ASYNC_URL, accessToken, body });
  let sub = await submit(authContext.session.access_token);
  if (sub.status === 401 || sub.status === 403) {
    await refreshAuthContext(authContext);
    sub = await submit(authContext.session.access_token);
  }
  return sub;
}

/**
 * Faz poll de um job mz-async até concluir. Retorna o resultado do run-agent-chat em 'done',
 * uma forma de falha em 'failed'/'not_found', OU um 504 {error, job_id, still_running:true} quando o
 * budget de poll do CLIENTE expira — NESSE caso o job SEGUE rodando no servidor (fire-and-forget); o
 * resultado persiste em mz_jobs/mz_messages e pode ser retomado com o mesmo job_id (--resume).
 * onPhase(phase, phases) (opcional) é chamado quando o servidor reporta mudança de fase (progresso).
 */
async function pollAsyncJob(authContext, jobId, { budgetMs = 290000, onPhase = null } = {}) {
  const started = Date.now();
  let lastPhase = null;
  for (let i = 0; Date.now() - started < budgetMs; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1200 : 3000));
    const st = await invokeJsonEdge({ url: MZ_ASYNC_URL, accessToken: authContext.session.access_token, body: { action: "status", job_id: jobId } });
    const p = st.payload || {};
    if (onPhase && p.phase && p.phase !== lastPhase) { lastPhase = p.phase; try { onPhase(p.phase, p.phases || []); } catch { /* progresso best-effort */ } }
    if (p.status === "done") return { ok: true, status: 200, payload: p.result || {}, rawText: JSON.stringify(p.result || {}), jobId };
    if (p.status === "failed") return { ok: false, status: 502, payload: { server_failed: true, error: p.error || "job failed", phase: p.phase || null, result: p.result ?? null, job_id: jobId }, rawText: "", jobId };
    if (p.status === "not_found") return { ok: false, status: 404, payload: { error: "job not found", job_id: jobId }, rawText: "", jobId };
  }
  // Budget do CLIENTE esgotado — o job NÃO foi morto; continua no servidor. Devolve o job_id p/ retomar.
  return { ok: false, status: 504, payload: { error: "job timeout", job_id: jobId, still_running: true }, rawText: "", jobId };
}

/**
 * Chama o agente (run-agent-chat) SEMPRE pelo caminho async do mz-async (submit → poll), robusto p/
 * tarefas longas que estouram a janela síncrona do edge (~100s). Parâmetros de FB4 (todos opcionais,
 * defaults preservam o comportamento antigo p/ agent.mjs/plan.mjs):
 *  - pollBudgetMs: quanto o CLIENTE espera o job (default 290000). Estourou → 504 com job_id (não morre server-side).
 *  - asyncOnly: submete e retorna o job_id IMEDIATAMENTE (não aguarda) — p/ scripting/tarefas muito longas.
 *  - resumeJobId: pula o submit e só faz poll de um job já existente (retomar após timeout do cliente).
 *  - onPhase: callback de progresso por fase.
 */
export async function askAgent(authContext, { prompt, agentId, companyId, systemPromptOverride = null, sessionId = null, pollBudgetMs = 290000, asyncOnly = false, resumeJobId = null, onPhase = null }) {
  // RESUME: retoma o poll de um job já submetido (não re-submete, não precisa de prompt/company/agent).
  if (resumeJobId) return pollAsyncJob(authContext, resumeJobId, { budgetMs: pollBudgetMs, onPhase });

  // CONTRATO DE EXECUÇÃO (7a, fail-closed): todo spawn carrega o system selado
  // (ground-zero + guardas). Override cru sem o contrato → lança e bloqueia o spawn.
  const body = {
    kind: "chat",
    messages: [{ role: "user", content: prompt }],
    agent_id: agentId,
    company_id: companyId,
    client_name: "mz-cli", // identifica origem CLI (gating de plano pago no run-agent-chat)
    system_prompt_override: enforceExecutionContract(systemPromptOverride),
    // session_id (opcional): SÓ no caminho CONVERSACIONAL (mz ask). Dá memória turno-a-turno —
    // o run-agent-chat faz recall determinístico por session_id+company+agent (sem vazamento cross-sessão,
    // o escopo é server-side). Omitido em generateEdits/plan (one-shot, não são conversa).
    ...(sessionId ? { session_id: sessionId } : {}),
  };

  const sub = await submitAsyncJob(authContext, body);
  const jobId = sub.payload && sub.payload.job_id;
  if (!jobId) return sub; // erro no submit → devolve como está (ex.: gating 403)

  // ASYNC-ONLY (--async): não bloqueia — devolve o job_id p/ o cliente retomar quando quiser.
  if (asyncOnly) return { ok: true, status: 202, payload: { async: true, job_id: jobId }, rawText: "", jobId };

  return pollAsyncJob(authContext, jobId, { budgetMs: pollBudgetMs, onPhase });
}

/** Extracts the human-readable answer from either the JSON or plain-text response shape. */
export function extractResponseText(result) {
  if (result.payload && typeof result.payload === "object") {
    if (typeof result.payload.response_text === "string" && result.payload.response_text.length > 0) {
      return result.payload.response_text;
    }
    if (typeof result.payload.response === "string" && result.payload.response.length > 0) {
      return result.payload.response;
    }
  }
  return result.rawText || "";
}
