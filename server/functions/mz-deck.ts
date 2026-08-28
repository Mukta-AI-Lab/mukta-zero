// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// mz-deck — orquestrador fino brief→deck (item 3b). Contrato mukta-edge (req, ctx). NÃO edita o chat-core nem duplica dispatch.
// Fluxo (empacota o smoke provado): fetch slot_schema do template_id (ctx.sql) → PLANNER via run-agent-chat (LLM já existe lá)
// → parse slots → compose via mz-office (compose_pptx) → devolve signed_url. Auth: JWT do user (forwarded internamente).
const KONG_FN = "http://kong:8000/functions/v1";

function extractJson(txt: string): any {
  if (!txt) return null;
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export default async function (req: Request, ctx: any) {
  // CORS whitelist (CLAUDE.md P0: '*' proibido). CLI não manda Origin → liberado (auth por JWT); browser só de domínio confiável.
  const _allowed = ["https://app.example.com", "https://api.example.com"]; const _o = req.headers.get("origin");
  const CORS: Record<string, string> = { "Access-Control-Allow-Origin": !_o ? "*" : (_allowed.includes(_o) ? _o : _allowed[0]), "Access-Control-Allow-Headers": "apikey, content-type, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
  const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  const apikey = req.headers.get("apikey") || "";
  const authz = req.headers.get("authorization") || "";
  if (!authz.toLowerCase().startsWith("bearer ")) return j({ error: "Authorization Bearer (JWT do user) requerido" }, 401);
  const fwd = { apikey, Authorization: authz, "content-type": "application/json" };
  try {
    const body = await req.json();
    const brief = body.brief;
    if (!brief) return j({ error: "brief requerido" }, 400);
    const templateId = body.template_id;

    // ── GATILHO AUTOMÁTICO: Técnica B (adapt-template) vs A (worker python-pptx from-scratch) ──
    // template_id dado → B (adapta golden-master). Sem template OU premium OU technique:"worker" → A (gera layouts arbitrários).
    const useWorker = body.technique === "worker" || body.premium === true || !templateId;
    if (useWorker) {
      // Técnica A — DOGFOOD do MZ: planner brief→deck_spec (contrato do worker) via run-agent-chat → compose_via_worker
      const CONTRACT = `deck_spec = {footer_text(<=90), slides:[2-8]}. Cada slide tem "layout" + os campos do layout. Layouts:
- hero: {kicker<=60,title<=90,subtitle<=220}
- agenda: {kicker<=60,title<=90,items:[3-7]<=60}
- cards: {kicker<=60,title<=90,subtitle?<=180,takeaway?<=110,cards:[2-4] de {tag<=18,title<=60,desc<=220,tone:red|blue|green|slate}}
- kpis: {kicker<=60,title<=90,subtitle?<=180,cards:[2-4] de {value<=14,label<=40,desc<=130,accent:blue|sky|navy|green}}
- comparison: {kicker<=60,title<=90,left_title<=40,right_title<=40,left_items:[2-5]<=140,right_items:[2-5]<=140}
- timeline: {kicker<=60,title<=90,phases:[2-5] de {marker<=4,title<=45,desc<=160}}
- quote: {text<=200,author<=60,role<=80}  - cta: {title<=80,subtitle<=180,button<=30,contact<=60}
NUNCA exceda os limites (o engine mede tipograficamente e REJEITA).`;
      const planSpec = async (extra: string) => {
        const prompt = `Você é um PLANNER de apresentações. A partir do BRIEF, produza um deck_spec coeso (capa hero + 2-5 slides de conteúdo com layouts variados adequados) respeitando ESTRITAMENTE os limites. ${CONTRACT}${extra} BRIEF: "${String(brief).slice(0, 2500)}". Responda SOMENTE JSON {"footer_text":"...","slides":[...]} sem texto fora do JSON.`;
        const r = await fetch(`${KONG_FN}/run-agent-chat`, { method: "POST", headers: fwd, body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }) });
        const pjj = await r.json().catch(() => ({}));
        return { spec: extractJson(pjj.response_text || pjj.text || ""), excerpt: String(pjj.response_text || "").slice(0, 220) };
      };
      let ps = await planSpec("");
      if (!ps.spec || !Array.isArray(ps.spec.slides) || !ps.spec.slides.length) return j({ error: "planner não produziu deck_spec válido", planner_excerpt: ps.excerpt }, 502);
      const callWorker = () => fetch(`${KONG_FN}/mz-office`, { method: "POST", headers: fwd, body: JSON.stringify({ action: "compose_via_worker", deck_spec: ps.spec, file_name: body.file_name || "deck", project_id: body.project_id || null, durable: body.durable === true }) });
      let cj = await (await callWorker()).json().catch(() => ({}));
      if (!cj.ok && cj.detail) { // worker rejeitou (422 lint/validação) → re-planeja 1× com o erro
        const re = await planSpec(` A tentativa anterior foi REJEITADA pelo engine: ${String(cj.detail).slice(0, 220)}. Corrija e refaça.`);
        if (re.spec && Array.isArray(re.spec.slides)) { ps = re; cj = await (await callWorker()).json().catch(() => ({})); }
      }
      if (!cj.ok) return j({ error: "compose_via_worker falhou: " + (cj.error || "?"), deck_spec: ps.spec }, 502);
      return j({ ok: true, technique: "worker", slides: cj.slides, lint_pass: cj.lint_pass, deck_spec: ps.spec, file_name: cj.file_name, bytes_len: cj.bytes_len, storage_path: cj.storage_path, signed_url: cj.signed_url, gcs_url: cj.gcs_url ?? null });
    }

    // ── Técnica B (adapt-template) — template_id garantido ──
    // 1) slot_schema do template
    let schema: any[] = [];
    try { const r = await ctx.sql`select slot_schema from public.mz_pptx_templates where slug=${templateId} or id::text=${templateId} limit 1`; schema = r[0]?.slot_schema || []; }
    catch (e) { return j({ error: "schema fetch: " + String(e) }, 500); }
    if (!Array.isArray(schema) || !schema.length) return j({ error: `template '${templateId}' não encontrado ou sem slot_schema` }, 404);

    // 2) PLANNER via run-agent-chat (reusa o LLM/dispatch existente; sem duplicação)
    const slotList = schema.map((s: any) => `${s.slot} (máx ${s.max} chars${s.label ? ", " + s.label : ""})`).join(", ");
    const plan = async (extra: string) => {
      const prompt = `Você é um PLANNER de slides. A partir do BRIEF, preencha os slots do template respeitando ESTRITAMENTE o limite de caracteres de cada slot. Slots: ${slotList}. BRIEF: "${String(brief).slice(0, 2000)}".${extra} Responda SOMENTE JSON {"slots":{${schema.map((s: any) => `"${s.slot}":"..."`).join(",")}}} sem texto fora do JSON.`;
      const r = await fetch(`${KONG_FN}/run-agent-chat`, { method: "POST", headers: fwd, body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }) });
      const pjj = await r.json().catch(() => ({}));
      const t = pjj.response_text || pjj.text || "";
      const p = extractJson(t);
      return { slots: p?.slots || p, excerpt: String(t).slice(0, 200) };
    };
    const first = await plan("");
    const slots: any = first.slots;
    if (!slots || typeof slots !== "object") return j({ error: "planner não produziu slots válidos", planner_excerpt: first.excerpt }, 502);
    // GATE de FIT determinístico (D3 overflow): slot além do max → re-pedir ao planner encurtar (1 retry) ANTES de clampar
    const overList = () => schema.filter((s: any) => typeof slots[s.slot] === "string" && s.max && slots[s.slot].length > s.max);
    const gate: any = { refit: false, clamped: [] };
    let over = overList();
    if (over.length) {
      gate.refit = true;
      const which = over.map((s: any) => `${s.slot} (atual ${slots[s.slot].length}, máx ${s.max})`).join("; ");
      const re = await plan(` ATENÇÃO: encurte para caber estes slots que estouraram: ${which}. Mantenha o sentido, seja conciso.`);
      if (re.slots && typeof re.slots === "object") for (const s of schema) if (typeof re.slots[s.slot] === "string") slots[s.slot] = re.slots[s.slot];
      over = overList();
    }
    // clamp de último recurso (NÃO silencioso — registra o que foi cortado)
    for (const s of over) { gate.clamped.push(s.slot); slots[s.slot] = slots[s.slot].slice(0, s.max); }

    // 3) compose via mz-office (compose_pptx template_id + slots) — persiste + signed_url
    const cr = await fetch(`${KONG_FN}/mz-office`, { method: "POST", headers: fwd, body: JSON.stringify({ action: "compose_pptx", template_id: templateId, slots, file_name: body.file_name || "deck", project_id: body.project_id || null, durable: body.durable === true }) });
    const cj = await cr.json().catch(() => ({}));
    if (!cj.ok) return j({ error: "compose falhou: " + (cj.error || "?"), slots }, 502);
    // gate D5: markers não preenchidos (slot esquecido) — sinaliza (não falha a entrega, mas expõe)
    return j({ ok: true, technique: "adapt-template", template_id: templateId, slots, fit_gate: gate, unfilled_markers: cj.unfilled_markers ?? null, file_name: cj.file_name, bytes_len: cj.bytes_len, storage_path: cj.storage_path, signed_url: cj.signed_url, gcs_url: cj.gcs_url ?? null, file_id: cj.file_id });
  } catch (e) {
    return j({ error: String(e) }, 500);
  }
}
