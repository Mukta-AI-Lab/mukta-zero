// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// mz-workflow — estado COMPARTILHADO de workflows/missões entre CLI e PORTAL. Contrato mukta-edge (req,{sql,getSecret}).
// Reusa as tabelas server-side JÁ existentes mz_missions (goal/status/steps_total/done) + mz_mission_steps
// (idx/title/spec/status/depends_on). Um workflow criado no CLI vira uma missão no server → o portal lê as MESMAS
// linhas (viz é do front). Escopo por user_id do JWT (o sql do mukta-edge não tem auth.uid).

function b64urlToBytes(s: string): Uint8Array { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
async function verifyJwt(token: string, secret: string): Promise<any> {
  const p = token.split("."); if (p.length !== 3) throw new Error("jwt malformado");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("HMAC", key, b64urlToBytes(p[2]), new TextEncoder().encode(`${p[0]}.${p[1]}`))) throw new Error("assinatura inválida");
  const c = JSON.parse(new TextDecoder().decode(b64urlToBytes(p[1])));
  if (c.exp && Date.now() / 1000 > c.exp) throw new Error("token expirado");
  if (!c.sub) throw new Error("sem sub");
  return c;
}
const STEP_STATUS = ["planned", "running", "done", "failed", "skipped"];
const RUN_STATUS = ["pending", "running", "done", "failed", "cancelled"];

export default async function (req: Request, ctx: { sql: any; getSecret: (n: string) => string | undefined }) {
  const { sql, getSecret } = ctx;
  const _allowed = ["https://app.example.com", "https://api.example.com"]; const _o = req.headers.get("origin");
  const CORS: Record<string, string> = { "Access-Control-Allow-Origin": !_o ? "*" : (_allowed.includes(_o) ? _o : _allowed[0]), "Access-Control-Allow-Headers": "apikey, content-type, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
  const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  const secret = getSecret("JWT_SECRET") || getSecret("GOTRUE_JWT_SECRET");
  if (!secret) return j({ error: "server_misconfig" }, 500);
  let userId: string;
  try { userId = (await verifyJwt((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), secret)).sub; } catch (e) { return j({ error: "unauthorized", detail: String((e as Error).message || e) }, 401); }
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const action = String(body.action || "");
  const own = async (id: string) => (await sql`select 1 from public.mz_missions where id = ${id}::uuid and user_id = ${userId}::uuid limit 1`).length > 0;
  try {
    if (action === "create_run") {
      const goal = String(body.goal || "").slice(0, 2000);
      const total = Number.isFinite(+body.steps_total) ? +body.steps_total : (Array.isArray(body.steps) ? body.steps.length : 0);
      if (!goal) return j({ error: "goal requerido" }, 400);
      const r = await sql`insert into public.mz_missions (user_id, goal, status, steps_total, steps_done, started_at) values (${userId}::uuid, ${goal}, 'running', ${total}, 0, now()) returning id, goal, status`;
      // registra os steps iniciais se enviados
      if (Array.isArray(body.steps)) {
        for (let i = 0; i < body.steps.length; i++) { const s = body.steps[i]; await sql`insert into public.mz_mission_steps (mission_id, user_id, idx, title, spec, status) values (${r[0].id}::uuid, ${userId}::uuid, ${i}, ${String(s.title || s).slice(0, 300)}, ${String(s.spec || "").slice(0, 2000)}, 'planned')`; }
      }
      return j({ ok: true, run: r[0] });
    }
    if (action === "list_runs") {
      const r = await sql`select id, goal, status, steps_total, steps_done, created_at, started_at, ended_at from public.mz_missions where user_id = ${userId}::uuid order by created_at desc limit 50`;
      return j({ ok: true, runs: r });
    }
    if (action === "get_run") {
      const id = String(body.run_id || ""); if (!await own(id)) return j({ error: "run não encontrado" }, 404);
      const m = await sql`select id, goal, status, steps_total, steps_done, created_at, started_at, ended_at from public.mz_missions where id = ${id}::uuid limit 1`;
      const steps = await sql`select id, idx, title, spec, status, artifact_id from public.mz_mission_steps where mission_id = ${id}::uuid order by idx asc`;
      return j({ ok: true, run: m[0], steps });
    }
    if (action === "add_step") {
      const id = String(body.run_id || ""); if (!await own(id)) return j({ error: "run não encontrado" }, 404);
      const idx = Number.isFinite(+body.idx) ? +body.idx : 0;
      const r = await sql`insert into public.mz_mission_steps (mission_id, user_id, idx, title, spec, status) values (${id}::uuid, ${userId}::uuid, ${idx}, ${String(body.title || "").slice(0, 300)}, ${String(body.spec || "").slice(0, 2000)}, 'planned') returning id`;
      return j({ ok: true, step_id: r[0].id });
    }
    if (action === "update_step") {
      const sid = String(body.step_id || ""); const status = STEP_STATUS.includes(String(body.status)) ? String(body.status) : null;
      if (!sid || !status) return j({ error: "step_id + status válido requeridos" }, 400);
      const r = await sql`update public.mz_mission_steps set status = ${status} where id = ${sid}::uuid and user_id = ${userId}::uuid returning mission_id`;
      if (!r.length) return j({ error: "step não encontrado" }, 404);
      // recomputa steps_done na missão
      await sql`update public.mz_missions set steps_done = (select count(*) from public.mz_mission_steps where mission_id = ${r[0].mission_id}::uuid and status = 'done') where id = ${r[0].mission_id}::uuid`;
      return j({ ok: true });
    }
    if (action === "update_run") {
      const id = String(body.run_id || ""); const status = RUN_STATUS.includes(String(body.status)) ? String(body.status) : null;
      if (!await own(id)) return j({ error: "run não encontrado" }, 404);
      if (!status) return j({ error: "status inválido" }, 400);
      const ended = (status === "done" || status === "failed" || status === "cancelled") ? sql`now()` : null;
      await sql`update public.mz_missions set status = ${status}, ended_at = ${ended} where id = ${id}::uuid`;
      return j({ ok: true });
    }
    return j({ error: "unknown_action", actions: ["create_run", "list_runs", "get_run", "add_step", "update_step", "update_run"] }, 400);
  } catch (e) { return j({ error: "workflow_error", detail: String((e as Error).message || e).slice(0, 160) }, 500); }
}
