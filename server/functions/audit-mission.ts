// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// Mukta Zero — Fase 8g AUDITOR/INSPETOR. Dado um mission_id, lê os FATOS da missão
// (mz_missions/mz_mission_steps/mz_agent_runs/mz_handoffs — SÓ-LEITURA), detecta anomalias
// por regra determinística, e pede ao CÉREBRO (ladder SSOT) um relatório+veredito sob o
// contrato 7a (analista read-only, factual, PII-safe). Persiste em mz_agent_audits.
// Contrato mukta-edge: (req, {sql, getSecret}). NÃO muta os dados auditados.

function b64urlToBytes(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToJson(s: string): any { return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))); }
async function verifyJwt(token: string, secret: string): Promise<any> {
  const parts = token.split("."); if (parts.length !== 3) throw new Error("jwt malformado");
  const [h, p, sig] = parts;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("assinatura inválida");
  const claims = b64urlToJson(p);
  if (claims.exp && Date.now() / 1000 > claims.exp) throw new Error("token expirado");
  if (!claims.sub) throw new Error("sem sub");
  return claims;
}

// Contrato 7a inline: o auditor é um analista SOMENTE-LEITURA, factual e PII-safe.
const AUDIT_CONTRACT = [
  "[[MZ_EXECUTION_CONTRACT_v1]]",
  "Você é o AUDITOR/INSPETOR do Mukta Zero — um analista SOMENTE-LEITURA de execuções de agentes.",
  "REGRAS INVIOLÁVEIS:",
  "- Baseie-se EXCLUSIVAMENTE nos FATOS fornecidos. NÃO invente dados, métricas nem eventos.",
  "- Você NÃO executa ações, NÃO modifica nada e NÃO propõe comandos destrutivos. Apenas analisa e relata.",
  "- Não exponha segredos nem PII. Trabalhe com contagens, status, modelos, latências, tokens e resumos.",
  "Produza um relatório claro em português cobrindo: (1) o que a missão fez; (2) consumo (tokens/latência/modelos); (3) fluxo entre os times (handoffs); (4) anomalias; (5) um VEREDITO com justificativa.",
  'Responda SOMENTE JSON: {"verdict":"ok|atencao|falha","report":"texto do relatório em markdown curto"}.',
].join("\n");

export default async function (req: Request, ctx: { sql: any; getSecret: (n: string) => string | undefined }) {
  const { sql, getSecret } = ctx;
  const origin = req.headers.get("origin") || "*";
  const cors: Record<string, string> = {
    "access-control-allow-origin": origin, "access-control-allow-headers": "apikey, content-type, authorization",
    "access-control-allow-methods": "POST, OPTIONS", "vary": "Origin",
  };
  const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  const secret = getSecret("JWT_SECRET") || getSecret("GOTRUE_JWT_SECRET");
  if (!secret) return j({ error: "server_misconfig" }, 500);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let claims: any;
  try { claims = await verifyJwt(token, secret); } catch (e) { return j({ error: "unauthorized", detail: String((e as Error).message || e) }, 401); }
  const userId = claims.sub as string;

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const missionId = (body.mission_id || "").toString().trim();
  if (!missionId) return j({ error: "empty_mission_id" }, 400);

  // 1) LER (owner-scoped) — a missão deve pertencer ao usuário
  let mission: any = null;
  try {
    const r = await sql`select id, goal, status, steps_total, steps_done, created_at, started_at, ended_at, killed_at, kill_requested_at
      from mz_missions where id = ${missionId}::uuid and user_id = ${userId}::uuid`;
    mission = r[0] || null;
  } catch (e) { return j({ error: "mission_read_failed", detail: String((e as Error).message || e).slice(0, 160) }, 500); }
  if (!mission) return j({ error: "not_found_or_forbidden" }, 404);

  let steps: any[] = []; let runs: any[] = []; let handoffs: any[] = [];
  try { steps = await sql`select idx, title, status, role, phase_id, artifact_id from mz_mission_steps where mission_id = ${missionId}::uuid order by idx`; } catch { /* */ }
  try { runs = await sql`select role, phase_id, kind, status, model_slug, tokens_used, latency_ms, step_id from mz_agent_runs where mission_id = ${missionId}::uuid order by started_at`; } catch { /* */ }
  try { handoffs = await sql`select from_team, to_team, phase, summary from mz_handoffs where mission_id = ${missionId}::uuid order by created_at`; } catch { /* */ }

  // 2) FATOS determinísticos
  const totalTokens = runs.reduce((a, r) => a + (Number(r.tokens_used) || 0), 0);
  const totalLatency = runs.reduce((a, r) => a + (Number(r.latency_ms) || 0), 0);
  const models = Array.from(new Set(runs.map((r) => r.model_slug).filter(Boolean)));
  const failedSteps = steps.filter((s) => s.status === "failed");

  // 3) ANOMALIAS por regra
  const anomalies: string[] = [];
  if (mission.killed_at) anomalies.push("Missão interrompida pelo kill-switch (control tower).");
  if ((mission.steps_done ?? 0) < (mission.steps_total ?? 0)) anomalies.push(`Entrega parcial: ${mission.steps_done}/${mission.steps_total} passos concluídos.`);
  for (const f of failedSteps) anomalies.push(`Passo #${f.idx} (${f.title || "sem título"}) falhou.`);
  const latHigh = runs.filter((r) => (Number(r.latency_ms) || 0) > 60000);
  for (const r of latHigh) anomalies.push(`Latência alta (${r.latency_ms}ms) no papel ${r.role || "?"}.`);
  const runsNoTokens = runs.filter((r) => (Number(r.tokens_used) || 0) === 0 && r.status === "done");
  if (runsNoTokens.length) anomalies.push(`${runsNoTokens.length} run(s) sem tokens contabilizados (telemetria pré-fix ou provider sem usage).`);

  // Veredito determinístico (piso — o cérebro não pode reportar melhor que os fatos)
  let floorVerdict = "ok";
  if ((mission.steps_done ?? 0) === 0) floorVerdict = "falha";
  else if (mission.killed_at || failedSteps.length > 0 || (mission.steps_done ?? 0) < (mission.steps_total ?? 0)) floorVerdict = "atencao";

  const facts = {
    goal: String(mission.goal || "").slice(0, 200),
    status: mission.status,
    steps_total: mission.steps_total,
    steps_done: mission.steps_done,
    killed: !!mission.killed_at,
    consumption: { total_tokens: totalTokens, total_latency_ms: totalLatency, models },
    steps: steps.map((s) => ({ idx: s.idx, title: s.title, status: s.status, role: s.role, phase: s.phase_id, has_artifact: !!s.artifact_id })),
    runs: runs.map((r) => ({ role: r.role, phase: r.phase_id, kind: r.kind, status: r.status, model: r.model_slug, tokens: Number(r.tokens_used) || 0, latency_ms: Number(r.latency_ms) || 0 })),
    handoffs: handoffs.map((h) => ({ from: h.from_team, to: h.to_team, phase: h.phase, summary: h.summary })),
    anomalies,
    floor_verdict: floorVerdict,
  };

  // 4) CÉREBRO — ladder SSOT + veredito/relatório sob contrato read-only
  let ladder: any[] = [];
  try { ladder = await sql`select provider, model_slug, base_url from llm_models where is_active = true order by priority asc, created_at asc`; }
  catch (e) { return j({ error: "model_lookup_failed", detail: String((e as Error).message || e) }, 500); }
  if (!ladder.length) return j({ error: "no_active_model" }, 500);

  const dispatch = async (messages: any[]): Promise<{ content: string; tokens: number; model: string }> => {
    for (const m of ladder) {
      const keyName = `${String(m.provider).toUpperCase()}_API_KEY`;
      let key: string | undefined;
      try { const r = await sql`select public.get_vault_secret(${keyName}) as v`; key = r[0]?.v || undefined; } catch { /* */ }
      key = key || getSecret(keyName);
      if (!key) continue;
      try {
        const payload: any = { model: m.model_slug, messages, temperature: 0.15, max_tokens: 1600, response_format: { type: "json_object" } };
        const resp = await fetch(`${String(m.base_url).replace(/\/+$/, "")}/chat/completions`, {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(payload),
        });
        const raw = await resp.text(); if (!resp.ok) continue;
        let parsed: any = null; try { parsed = JSON.parse(raw); } catch { /* */ }
        const content = parsed?.choices?.[0]?.message?.content ?? "";
        if (content && content.trim()) return { content, tokens: Number(parsed?.usage?.total_tokens) || 0, model: m.model_slug };
      } catch { /* próximo */ }
    }
    return { content: "", tokens: 0, model: "" };
  };

  const dres = await dispatch([
    { role: "system", content: AUDIT_CONTRACT },
    { role: "user", content: "FATOS DA MISSÃO (audite; não invente nada fora disto):\n" + JSON.stringify(facts) },
  ]);

  let verdict = floorVerdict; let report = "";
  try {
    const parsed = JSON.parse(dres.content);
    report = String(parsed.report || "").slice(0, 8000);
    const vv = String(parsed.verdict || "").toLowerCase();
    if (["ok", "atencao", "falha"].includes(vv)) verdict = vv;
  } catch { report = dres.content ? String(dres.content).slice(0, 8000) : ""; }

  // piso: nunca melhor que os fatos determinísticos
  const rank: Record<string, number> = { ok: 0, atencao: 1, falha: 2 };
  if ((rank[verdict] ?? 0) < (rank[floorVerdict] ?? 0)) verdict = floorVerdict;
  if (!report) report = `Auditoria automática — veredito ${verdict}. ${anomalies.length ? "Anomalias: " + anomalies.join(" ") : "Sem anomalias detectadas por regra."}`;

  // 5) PERSISTIR o relatório (output; não muta os dados auditados)
  let auditId: string | null = null;
  try {
    const r = await sql`insert into mz_agent_audits (user_id, mission_id, verdict, report, facts, anomalies, model_slug, tokens_used)
      values (${userId}::uuid, ${missionId}::uuid, ${verdict}, ${report}, ${facts}, ${anomalies}, ${dres.model || null}, ${dres.tokens})
      returning id`;
    auditId = r[0]?.id || null;
  } catch { /* best-effort */ }

  return j({ audit_id: auditId, mission_id: missionId, verdict, report, anomalies, facts, model: dres.model, tokens_used: dres.tokens });
}
