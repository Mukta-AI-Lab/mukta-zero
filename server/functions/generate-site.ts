// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// Mukta Zero — Fase 3 studio/site-gen (MVP sem code-exec).
// Gera um artefato de site (HTML standalone) a partir de um pedido, via o cérebro SSOT,
// e persiste em mz_artifacts (escopo do usuário). Contrato mukta-edge: (req, {sql, getSecret}).
// FlexCode completo (validação por execução) depende do code-exec (deferido) — aqui é LLM→HTML→artefato.

function b64urlToBytes(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToJson(s: string): any { return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))); }
async function verifyJwt(token: string, secret: string): Promise<any> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("jwt malformado");
  const [h, p, sig] = parts;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("assinatura inválida");
  const claims = b64urlToJson(p);
  if (claims.exp && Date.now() / 1000 > claims.exp) throw new Error("token expirado");
  if (!claims.sub) throw new Error("sem sub");
  return claims;
}

// Remove cercas markdown (```html ... ```) e texto fora do HTML.
function extractHtml(raw: string): string {
  let s = String(raw || "").trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const dt = s.search(/<!doctype html|<html/i);
  if (dt > 0) s = s.slice(dt);
  return s.trim();
}

export default async function (req: Request, ctx: { sql: any; getSecret: (n: string) => string | undefined }) {
  const { sql, getSecret } = ctx;
  const origin = req.headers.get("origin") || "*";
  const cors: Record<string, string> = {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "apikey, content-type, authorization",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
  const j = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  const secret = getSecret("JWT_SECRET") || getSecret("GOTRUE_JWT_SECRET");
  if (!secret) return j({ error: "server_misconfig" }, 500);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let claims: any;
  try { claims = await verifyJwt(token, secret); } catch (e) { return j({ error: "unauthorized", detail: String((e as Error).message || e) }, 401); }
  const userId = claims.sub as string;

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const spec = (body.spec || body.prompt || "").toString().trim();
  if (!spec) return j({ error: "empty_spec" }, 400);
  const title = (body.title || spec.slice(0, 60)).toString();
  const projectId = body.project_id || null;
  const conversationId = body.conversation_id || null;

  // resolve tenant + modelo primário (SSOT) — ladder por priority.
  let companyId: string | null = body.company_id || null;
  let agentId: string | null = body.agent_id || null;
  try {
    if (!companyId) { const r = await sql`select company_id from user_company_memberships where user_id = ${userId} limit 1`; companyId = r[0]?.company_id || null; }
    if (!agentId && companyId) { const r = await sql`select id from agent_profiles where company_id = ${companyId} and is_active = true limit 1`; agentId = r[0]?.id || null; }
  } catch { /* */ }

  let agentModelId: string | null = null;
  if (agentId) { try { const r = await sql`select model_id from agent_profiles where id = ${agentId} limit 1`; agentModelId = r[0]?.model_id || null; } catch { /* */ } }
  let ladder: any[] = [];
  try {
    ladder = await sql`select provider, model_slug, base_url from llm_models where is_active = true
      order by case when id = ${agentModelId} then 0 else 1 end, priority asc, created_at asc`;
  } catch (e) { return j({ error: "model_lookup_failed", detail: String((e as Error).message || e) }, 500); }
  if (!ladder.length) return j({ error: "no_active_model" }, 500);

  const system = "Você é o gerador de sites do Mukta Zero. Gere uma página HTML COMPLETA e STANDALONE "
    + "(<!doctype html>, <html>, <head> com <meta viewport> e <style> inline, <body>). Design moderno e responsivo, "
    + "sem dependências externas (nada de CDN/imagens remotas). Responda SOMENTE com o HTML — sem markdown, sem cercas, sem explicação.";
  const messages = [{ role: "system", content: system }, { role: "user", content: spec }];

  let html = "";
  let usedModel: any = null;
  const attempts: any[] = [];
  for (const m of ladder) {
    const keyName = `${String(m.provider).toUpperCase()}_API_KEY`;
    let key: string | undefined;
    try { const r = await sql`select public.get_vault_secret(${keyName}) as v`; key = r[0]?.v || undefined; } catch { /* */ }
    key = key || getSecret(keyName);
    if (!key) { attempts.push({ model: m.model_slug, error: "no_key" }); continue; }
    try {
      const resp = await fetch(`${String(m.base_url).replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: m.model_slug, messages, temperature: 0.3, max_tokens: 8192 }),
      });
      const raw = await resp.text();
      if (!resp.ok) { attempts.push({ model: m.model_slug, status: resp.status }); continue; }
      let content = "";
      try { content = JSON.parse(raw)?.choices?.[0]?.message?.content ?? ""; } catch { content = ""; }
      const extracted = extractHtml(content);
      if (extracted && /<html|<!doctype html/i.test(extracted)) { html = extracted; usedModel = m; break; }
      attempts.push({ model: m.model_slug, error: "no_html" });
    } catch (e) { attempts.push({ model: m.model_slug, error: String((e as Error).message || e).slice(0, 120) }); }
  }
  if (!html || !usedModel) return j({ error: "site_generation_failed", attempts }, 502);

  // persiste o artefato (user_id explícito — o sql do edge não tem auth.uid()).
  let artifactId: string | null = null;
  try {
    const r = await sql`insert into mz_artifacts (user_id, project_id, conversation_id, kind, title, content, model)
      values (${userId}::uuid, ${projectId}::uuid, ${conversationId}::uuid, 'site', ${title}, ${html}, ${usedModel.model_slug})
      returning id`;
    artifactId = r[0]?.id || null;
  } catch (e) { return j({ error: "persist_failed", detail: String((e as Error).message || e).slice(0, 160) }, 500); }

  return j({ artifact_id: artifactId, title, model: usedModel.model_slug, bytes: html.length, html });
}
