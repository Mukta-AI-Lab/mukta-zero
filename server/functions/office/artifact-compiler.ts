// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @module office/artifact-compiler  (W3 do roadmap mz-document-evolution-roadmap.md)
 * @description MOTOR DE ARTEFATOS COMPILADOS do Mukta Zero.
 *
 * Um pedido complexo com inputs HETEROGÊNEOS (pesquisa web + arquivos do workspace + dados) →
 *   GATHER  (web via SERP HMAC do MZ + arquivos via callback loadFile do dispatcher)
 *   → SÍNTESE seção-a-seção estruturada (brain SSOT role `mz_chat_brain`, bounded por deadline ~250s;
 *             Fontes com URLs REAIS capturadas do SERP; o brain NUNCA fabrica URLs — a lista de Fontes
 *             é montada SÓ do que o gather coletou)
 *   → RENDER de HTML RICO self-contained (hero, nav de seções, KPIs/cards/tabelas, gráficos INLINE via
 *             buildChartSvg→SVG, theme-aware light/dark, identidade teal do MZ; ZERO CDN/fonte externa).
 *
 * É o análogo do studio-composer para HTML — reusa o COMPOSITOR do estudo (run-agent-chat) sem reinventar
 * a síntese: mesmo padrão GATHER+brain SSOT+Fontes-reais, agora produzindo um artefato navegável (o que
 * produziu a própria gap-analysis / a validação adversarial). Reproduz um artefato tipo gap-analysis a
 * partir de um pedido (multi-input → HTML navegável self-contained), que é o gate do W3.
 *
 * Aterramento no MZ (zero import do produto principal — edge single-file, tudo via ctx.sql):
 *   - SERP: cliente HMAC do MZ (idêntico a run-agent-chat.callSerp / audit-integrity: Vault SERP_CENTRAL_*
 *           central-first + local-fallback). Porte 1:1 (o edge é bundlado por esbuild — sem import do central).
 *   - LLM SSOT: resolve role via llm_role_defaults×llm_models (base_url+provider_config), key via
 *               get_vault_secret. SÍNTESE usa a role `mz_chat_brain` (a MESMA do compositor do estudo) →
 *               ZERO slug hardcoded, ZERO modelo PRO fechado (a SSOT decide o modelo).
 *   - CHARTS: reusa buildChartSvg (o núcleo do render_chart) — em HTML o SVG é embutido INLINE (crisp,
 *             self-contained, CSP-safe), sem passar pela rasterização resvg (que é só p/ DOCX/PPTX).
 *   - Arquivos: o dispatcher (mz-office) injeta `loadFile(path)` (lê mz-uploads por JWT + parseDocxToBlocks) —
 *               mantém este módulo puro de fflate/storage e testável (esbuild.build → node no smoke).
 *
 * Bounded por deadline: 1 call de geração de queries (opcional) + SERP em paralelo + 1 call grande de
 * síntese (max_tokens ALTO — o brain é reasoning; controla-se o tamanho pelo PROMPT, não por max_tokens
 * apertado, senão content vazio st=200 len=0) + fallback de prosa. Cada fase checa o relógio; sempre
 * entrega ALGUM html (best-effort).
 */

// deno-lint-ignore no-explicit-any
type Sql = any;
// deno-lint-ignore no-explicit-any
type JsonRecord = Record<string, any>;

import { buildChartSvg } from "./chart-svg.ts";

// ===================== SERP (cliente HMAC do MZ — porte 1:1 de run-agent-chat / audit-integrity) =====================

async function signSerpBody(secret: string, body: string): Promise<{ ts: string; sig: string }> {
  const ts = new Date().toISOString();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${body}`));
  const sig = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { ts, sig };
}
async function callSerp(sql: Sql, path: string, payload: unknown, timeoutMs: number): Promise<{ ok: boolean; data?: any; via?: string }> {
  const body = JSON.stringify(payload);
  const getV = async (n: string): Promise<string | null> => { try { const r = await sql`select public.get_vault_secret(${n}) as v`; return r[0]?.v || null; } catch { return null; } };
  const attempt = async (base: string | null, secret: string | null, to: number, via: string) => {
    if (!base || !secret) return null;
    try {
      const { ts, sig } = await signSerpBody(secret, body);
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), to);
      const r = await fetch(`${base.replace(/\/+$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-mukta-timestamp": ts, "x-mukta-signature": sig }, body, signal: ctrl.signal }).finally(() => clearTimeout(t));
      if (!r.ok) return null;
      const jr = await r.json().catch(() => null);
      if (jr && jr.ok) return { ok: true, data: jr, via };
    } catch { /* cai p/ o fallback */ }
    return null;
  };
  const c = await attempt(await getV("SERP_CENTRAL_BASE_URL"), await getV("SERP_CENTRAL_HMAC_SECRET"), Math.min(timeoutMs, 20000), "central");
  if (c) return c;
  const l = await attempt(await getV("SERP_LOCAL_BASE_URL"), await getV("SERP_LOCAL_HMAC_SECRET"), timeoutMs, "local-fallback");
  if (l) return l;
  return { ok: false };
}
export type SerpHit = { title?: string; link?: string; snippet?: string };
async function serpSearch(sql: Sql, query: string, timeoutMs = 18000): Promise<SerpHit[]> {
  try {
    const res = await callSerp(sql, "/v1/google/search", { query: query.slice(0, 256), gl: "br", hl: "pt-br", atomic: true }, timeoutMs);
    if (!res.ok) return [];
    return (res.data?.organic || []).slice(0, 6).map((o: any) => ({ title: o.title, link: o.link, snippet: o.snippet }));
  } catch { return []; }
}

// ===================== LLM SSOT (resolve role → llm_models; key via Vault) =====================

interface ResolvedRole { base_url: string; model_slug: string; provider: string; provider_config: any; key: string }
async function resolveRole(sql: Sql, role: string): Promise<ResolvedRole | null> {
  try {
    const r = await sql`select m.base_url, m.model_slug, m.provider, m.provider_config
      from public.llm_role_defaults d join public.llm_models m on m.id = d.llm_model_id
      where d.role = ${role} and m.is_active = true limit 1`;
    const m = r[0]; if (!m || !m.base_url) return null;
    let key = "";
    try { const kr = await sql`select public.get_vault_secret(${String(m.provider).toUpperCase() + "_API_KEY"}) as k`; key = kr[0]?.k || ""; } catch { /* */ }
    if (!key) return null;
    return { base_url: m.base_url, model_slug: m.model_slug, provider: m.provider, provider_config: m.provider_config, key };
  } catch { return null; }
}
function parseLlmJson(text: string): JsonRecord | null {
  if (!text) return null;
  const stripped = String(text).replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(stripped); } catch { /* */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* */ } }
  return null;
}
// 1 chamada LLM → string crua do content (2 tentativas, timeout por chamada). max_tokens ALTO p/ reasoning-model.
async function llmContent(role: ResolvedRole, system: string, user: string, maxTokens = 8192, timeoutMs = 120000, temperature = 0.3): Promise<string> {
  const payload: JsonRecord = {
    model: role.model_slug, temperature, max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    ...(role.provider_config ? { provider: role.provider_config } : {}),
  };
  for (let a = 1; a <= 2; a++) {
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await fetch(`${role.base_url.replace(/\/+$/, "")}/chat/completions`, { method: "POST", signal: ac.signal, headers: { "content-type": "application/json", authorization: `Bearer ${role.key}` }, body: JSON.stringify(payload) });
      const raw = await resp.text();
      if (resp.ok) { try { const c = JSON.parse(raw)?.choices?.[0]?.message?.content || ""; if (c && c.trim()) return c; } catch { /* */ } }
    } catch { /* retry */ } finally { clearTimeout(tm); }
    if (a < 2) await new Promise((s) => setTimeout(s, 500));
  }
  return "";
}

// ===================== Tipos do artefato =====================

export interface ArtifactSource { title?: string; url: string }
export interface ChartSpec { chart_kind?: string; kind?: string; title?: string; categories?: string[]; series?: { name?: string; values?: number[] }[] }
export interface ArtifactTable { columns: string[]; rows: (string | number)[][] }
export interface ArtifactKpi { label: string; value: string; hint?: string }
export interface ArtifactCard { title: string; body: string }
export interface ArtifactSection {
  id?: string; heading: string; body?: string;
  kpis?: ArtifactKpi[]; cards?: ArtifactCard[]; table?: ArtifactTable; chart?: ChartSpec;
}
export interface ArtifactDoc { title: string; subtitle?: string; sections: ArtifactSection[] }

export interface ArtifactInputs { web_queries?: string[]; file_paths?: string[]; data?: any }
export interface CompileOptions {
  sql: Sql; brief: string; inputs?: ArtifactInputs; title?: string;
  deadlineMs?: number; maxQueries?: number;
  loadFile?: (path: string) => Promise<{ name: string; text: string } | null>;
  onPhase?: (phase: string, label: string) => void | Promise<void>;
}
export interface CompileResult {
  html: string; title: string; sections: { id: string; heading: string }[];
  sources: ArtifactSource[]; charts: number; notes: string[];
  meta: { web_queries: number; files_used: number; elapsed_ms: number; model?: string; via?: string };
}

// ===================== Render helpers (PUROS, sem rede) =====================

function esc(s: unknown): string { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function slugify(s: string, i: number): string { const b = String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48); return b || `sec-${i + 1}`; }
function proseToHtml(body: string): string {
  const paras = String(body || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of paras) {
    const lines = p.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const bullets = lines.filter((l) => /^[-*•]\s+/.test(l));
    if (bullets.length && bullets.length === lines.length) {
      out.push(`<ul>${lines.map((l) => `<li>${esc(l.replace(/^[-*•]\s+/, ""))}</li>`).join("")}</ul>`);
    } else {
      out.push(`<p>${esc(p.replace(/\s*\n\s*/g, " "))}</p>`);
    }
  }
  return out.join("");
}
function renderKpis(kpis: ArtifactKpi[]): string {
  const tiles = kpis.filter((k) => k && (k.label || k.value)).slice(0, 8).map((k) =>
    `<div class="kpi"><div class="kpi-v">${esc(k.value)}</div><div class="kpi-l">${esc(k.label)}</div>${k.hint ? `<div class="kpi-h">${esc(k.hint)}</div>` : ""}</div>`).join("");
  return tiles ? `<div class="kpis">${tiles}</div>` : "";
}
function renderCards(cards: ArtifactCard[]): string {
  const cs = cards.filter((c) => c && (c.title || c.body)).slice(0, 12).map((c) =>
    `<div class="card"><h3>${esc(c.title)}</h3><p>${esc(c.body)}</p></div>`).join("");
  return cs ? `<div class="cards">${cs}</div>` : "";
}
function renderTable(t: ArtifactTable): string {
  if (!t || !Array.isArray(t.columns) || !t.columns.length) return "";
  const head = `<tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
  const rows = (Array.isArray(t.rows) ? t.rows : []).slice(0, 200).map((r) =>
    `<tr>${(Array.isArray(r) ? r : [r]).slice(0, t.columns.length).map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("");
  return `<div class="tbl-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}
function renderChart(chart: ChartSpec, notes: string[]): { html: string; ok: boolean } {
  try {
    const built = buildChartSvg({ chart_kind: chart.chart_kind || chart.kind, title: chart.title, categories: chart.categories, series: chart.series, width: 960, height: 520, allow_empty: true });
    if (!built || built.points <= 0) return { html: "", ok: false };
    // SVG INLINE — self-contained, CSP-safe, crisp. Card sempre claro (o chart tem fundo branco em qualquer tema).
    return { html: `<figure class="chart">${built.svg}${chart.title ? `<figcaption>${esc(chart.title)}</figcaption>` : ""}</figure>`, ok: true };
  } catch (e) { notes.push("chart falhou: " + String((e as Error).message || e).slice(0, 80)); return { html: "", ok: false }; }
}

function styleBlock(): string {
  return `<style>
:root{--bg:#f6faf9;--surface:#ffffff;--surface-2:#eef5f3;--ink:#0e1c1a;--muted:#5a6a67;--border:#d8e4e1;--teal:#0d9488;--teal-600:#0f766e;--teal-700:#115e56;--teal-050:#e6f4f1;--shadow:0 1px 2px rgba(0,0,0,.04),0 6px 22px rgba(13,148,136,.07)}
@media (prefers-color-scheme:dark){:root{--bg:#0a1312;--surface:#101c1a;--surface-2:#15211f;--ink:#e6f0ee;--muted:#93a5a1;--border:#213330;--teal:#2dd4bf;--teal-600:#14b8a6;--teal-700:#0d9488;--teal-050:#12211f;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.28)}}
:root[data-theme=light]{--bg:#f6faf9;--surface:#ffffff;--surface-2:#eef5f3;--ink:#0e1c1a;--muted:#5a6a67;--border:#d8e4e1;--teal:#0d9488;--teal-600:#0f766e;--teal-700:#115e56;--teal-050:#e6f4f1;--shadow:0 1px 2px rgba(0,0,0,.04),0 6px 22px rgba(13,148,136,.07)}
:root[data-theme=dark]{--bg:#0a1312;--surface:#101c1a;--surface-2:#15211f;--ink:#e6f0ee;--muted:#93a5a1;--border:#213330;--teal:#2dd4bf;--teal-600:#14b8a6;--teal-700:#0d9488;--teal-050:#12211f;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.28)}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.62;font-size:16px;-webkit-font-smoothing:antialiased}
a{color:var(--teal-600);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1080px;margin:0 auto;padding:0 22px}
header.hero{background:linear-gradient(135deg,var(--teal-700),var(--teal));color:#fff;padding:44px 0 34px}
header.hero .wrap{position:relative}
.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.85;font-weight:700;margin:0 0 10px}
header.hero h1{margin:0;font-size:clamp(26px,4.4vw,40px);line-height:1.14;font-weight:800;letter-spacing:-.01em}
header.hero p.sub{margin:12px 0 0;font-size:clamp(15px,2vw,19px);opacity:.94;max-width:70ch}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
.chip{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:5px 13px;font-size:13px;font-weight:600}
.themebtn{position:absolute;top:0;right:22px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:999px;width:38px;height:38px;font-size:17px;cursor:pointer;line-height:1}
.layout{display:grid;grid-template-columns:212px 1fr;gap:34px;padding:34px 0 60px}
nav.toc{position:sticky;top:22px;align-self:start;font-size:14px}
nav.toc .toc-title{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:0 0 10px}
nav.toc ol{list-style:none;margin:0;padding:0;counter-reset:t}
nav.toc li{counter-increment:t;margin:2px 0}
nav.toc a{display:block;padding:7px 11px;border-radius:8px;color:var(--muted);border-left:2px solid transparent}
nav.toc a:hover{background:var(--surface-2);color:var(--ink);text-decoration:none}
nav.toc a::before{content:counter(t) ".";color:var(--teal);font-weight:700;margin-right:7px}
main{min-width:0}
section.block{background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);padding:26px 28px;margin:0 0 22px;scroll-margin-top:20px}
section.block>h2{margin:0 0 14px;font-size:22px;font-weight:750;letter-spacing:-.01em;display:flex;align-items:center;gap:10px}
section.block>h2::before{content:"";width:9px;height:22px;border-radius:3px;background:linear-gradient(var(--teal),var(--teal-700));flex:0 0 auto}
section.block p{margin:0 0 12px;color:var(--ink)}
section.block ul{margin:0 0 12px;padding-left:22px}section.block li{margin:4px 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:6px 0 16px}
.kpi{background:var(--teal-050);border:1px solid var(--border);border-radius:12px;padding:16px 14px}
.kpi-v{font-size:26px;font-weight:800;color:var(--teal-600);line-height:1.1;letter-spacing:-.02em}
.kpi-l{font-size:13px;color:var(--muted);margin-top:4px;font-weight:600}
.kpi-h{font-size:12px;color:var(--muted);margin-top:3px;opacity:.85}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:6px 0 16px}
.card{background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:16px}
.card h3{margin:0 0 7px;font-size:15px;font-weight:700}
.card p{margin:0;font-size:14px;color:var(--muted)}
.tbl-wrap{overflow-x:auto;margin:6px 0 16px;border:1px solid var(--border);border-radius:12px}
table{border-collapse:collapse;width:100%;font-size:14px}
thead th{background:var(--teal-700);color:#fff;text-align:left;padding:10px 13px;font-weight:650;white-space:nowrap}
tbody td{padding:9px 13px;border-top:1px solid var(--border)}
tbody tr:nth-child(even){background:var(--surface-2)}
figure.chart{margin:8px 0 6px;background:#fff;border:1px solid var(--border);border-radius:12px;padding:14px;overflow-x:auto}
figure.chart svg{max-width:100%;height:auto;display:block;margin:0 auto}
figure.chart figcaption{margin-top:8px;font-size:13px;color:#5a6a67;text-align:center;font-weight:600}
section.sources ol{margin:0;padding-left:20px}
section.sources li{margin:7px 0;word-break:break-word}
section.sources .src-t{font-weight:600}
section.sources .src-u{display:block;font-size:13px;color:var(--muted)}
footer{border-top:1px solid var(--border);color:var(--muted);font-size:13px;padding:22px 0 40px;text-align:center}
footer b{color:var(--teal-600)}
@media (max-width:760px){.layout{grid-template-columns:1fr;gap:8px}nav.toc{position:static;display:none}}
</style>`;
}
function themeScript(): string {
  // toggle inline (self-hosted, sem CDN): persiste em localStorage; respeita prefers-color-scheme por padrão.
  return `<script>(function(){try{var k="mz-artifact-theme";var s=localStorage.getItem(k);if(s)document.documentElement.setAttribute("data-theme",s);var b=document.getElementById("themebtn");if(b)b.addEventListener("click",function(){var cur=document.documentElement.getAttribute("data-theme");if(!cur)cur=matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light";var nx=cur==="dark"?"light":"dark";document.documentElement.setAttribute("data-theme",nx);localStorage.setItem(k,nx);});}catch(e){}})();</script>`;
}

// Monta o HTML final. PURO — recebe o doc estruturado, as fontes REAIS coletadas e a meta. Não faz rede.
export function buildArtifactHtml(doc: ArtifactDoc, sources: ArtifactSource[], meta: { compiledAt?: string }): { html: string; charts: number; toc: { id: string; heading: string }[] } {
  const notes: string[] = [];
  const secs = Array.isArray(doc.sections) ? doc.sections.filter((s) => s && s.heading) : [];
  const toc: { id: string; heading: string }[] = [];
  let chartCount = 0;
  const blocks: string[] = [];
  secs.forEach((s, i) => {
    const id = slugify(s.id || s.heading, i);
    toc.push({ id, heading: String(s.heading) });
    const inner: string[] = [];
    if (Array.isArray(s.kpis) && s.kpis.length) inner.push(renderKpis(s.kpis));
    if (s.body) inner.push(proseToHtml(s.body));
    if (s.chart) { const c = renderChart(s.chart, notes); if (c.ok) { inner.push(c.html); chartCount++; } }
    if (s.table) inner.push(renderTable(s.table));
    if (Array.isArray(s.cards) && s.cards.length) inner.push(renderCards(s.cards));
    blocks.push(`<section id="${esc(id)}" class="block"><h2>${esc(s.heading)}</h2>${inner.join("")}</section>`);
  });

  const realSources = (Array.isArray(sources) ? sources : []).filter((s) => s && /^https?:\/\//i.test(String(s.url)));
  if (realSources.length) {
    toc.push({ id: "fontes", heading: "Fontes" });
    const items = realSources.slice(0, 60).map((s) =>
      `<li><span class="src-t">${esc(s.title || s.url)}</span><a class="src-u" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url)}</a></li>`).join("");
    blocks.push(`<section id="fontes" class="block sources"><h2>Fontes</h2><ol>${items}</ol></section>`);
  }

  const tocHtml = toc.length ? `<nav class="toc" aria-label="Índice"><p class="toc-title">Neste artefato</p><ol>${toc.map((t) => `<li><a href="#${esc(t.id)}">${esc(t.heading)}</a></li>`).join("")}</ol></nav>` : "";
  const compiledAt = meta.compiledAt || new Date().toISOString().slice(0, 10);
  const chips = [
    `${secs.length} ${secs.length === 1 ? "seção" : "seções"}`,
    realSources.length ? `${realSources.length} ${realSources.length === 1 ? "fonte" : "fontes"}` : null,
    chartCount ? `${chartCount} ${chartCount === 1 ? "gráfico" : "gráficos"}` : null,
    "Compilado pelo Mukta Zero",
    compiledAt,
  ].filter(Boolean).map((c) => `<span class="chip">${esc(c)}</span>`).join("");

  const html = [
    styleBlock(),
    `<header class="hero"><div class="wrap"><button id="themebtn" class="themebtn" title="Alternar tema" aria-label="Alternar tema claro/escuro">&#9680;</button>`,
    `<p class="eyebrow">Artefato compilado</p><h1>${esc(doc.title || "Artefato")}</h1>`,
    doc.subtitle ? `<p class="sub">${esc(doc.subtitle)}</p>` : "",
    `<div class="chips">${chips}</div></div></header>`,
    `<div class="wrap"><div class="layout">${tocHtml}<main>${blocks.join("")}</main></div></div>`,
    `<footer class="wrap"><div>Gerado por <b>Mukta Zero</b> &mdash; motor de artefatos compilados &middot; ${esc(compiledAt)}</div></footer>`,
    themeScript(),
  ].join("\n");
  return { html, charts: chartCount, toc };
}

// ===================== SÍNTESE (brain SSOT) — estruturada com fallback de prosa =====================

const STRUCT_SYS =
  "Você é o COMPOSITOR de um ARTEFATO profissional (relatório/estudo/dossiê navegável). A partir do PEDIDO e " +
  "dos DADOS COLETADOS (pesquisa web + arquivos + dados), produza um artefato ESTRUTURADO, denso e objetivo. " +
  "Use SOMENTE as informações coletadas — NÃO invente números nem URLs. Responda SÓ JSON no formato:\n" +
  '{"title":"<título curto e forte>","subtitle":"<1 frase de escopo>","sections":[{' +
  '"heading":"<título da seção>","body":"<prosa densa, parágrafos separados por linha em branco; ~120-220 palavras>",' +
  '"kpis":[{"label":"<curto>","value":"<ex: 34% / R$ 2,4 bi>","hint":"<opcional>"}],' +
  '"cards":[{"title":"<curto>","body":"<1-2 frases>"}],' +
  '"table":{"columns":["..."],"rows":[["..."]]},' +
  '"chart":{"chart_kind":"bar|line|area|pie","title":"<curto>","categories":["..."],"series":[{"name":"...","values":[<números REAIS do texto>]}]}' +
  "}]}\n" +
  "REGRAS: 4-7 seções. Cada seção usa APENAS os enriquecimentos que fizerem sentido (kpis/cards/table/chart são " +
  "OPCIONAIS — omita o campo se não houver dado real). Inclua ao menos 1 chart OU 1 table OU 1 bloco de kpis se " +
  "houver dados numéricos concretos. NUNCA fabrique dados p/ preencher um gráfico. Não inclua seção 'Fontes' (ela é " +
  "montada automaticamente das URLs reais coletadas).";

const PROSE_SYS =
  "Você é REDATOR de um ESTUDO/RELATÓRIO profissional. Escreva um documento denso e bem estruturado em MARKDOWN " +
  "(use '## Título' para cada seção; 4-6 seções: contexto, análise com DADOS/NÚMEROS concretos dos dados coletados, " +
  "conclusão), usando SOMENTE as informações coletadas. NÃO invente URLs. Não inclua uma seção de Fontes (ela é " +
  "anexada automaticamente).";

// Fallback: markdown → ArtifactDoc (## → seções; parágrafos/bullets viram body). Reusa a ideia do markdownToBlocks.
function markdownToDoc(md: string, fallbackTitle: string): ArtifactDoc {
  const lines = String(md || "").split(/\n/);
  const sections: ArtifactSection[] = [];
  let title = fallbackTitle; let cur: ArtifactSection | null = null; const buf: string[] = [];
  const flush = () => { if (cur) { cur.body = buf.join("\n").trim(); sections.push(cur); } buf.length = 0; };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const h1 = line.match(/^#\s+(.+)/); const h2 = line.match(/^#{2,6}\s+(.+)/);
    if (h1) { title = h1[1].replace(/[*_`#]/g, "").trim() || title; continue; }
    if (h2) { flush(); cur = { heading: h2[1].replace(/[*_`#]/g, "").trim().slice(0, 160) }; continue; }
    if (!cur) { if (line.trim()) cur = { heading: "Resumo" }; else continue; }
    buf.push(line.replace(/[*_`]/g, ""));
  }
  flush();
  if (!sections.length) sections.push({ heading: "Conteúdo", body: String(md || "").replace(/[*_`#]/g, "").trim().slice(0, 8000) });
  return { title, sections };
}

function sanitizeDoc(raw: JsonRecord, fallbackTitle: string): ArtifactDoc | null {
  if (!raw || !Array.isArray(raw.sections)) return null;
  const sections: ArtifactSection[] = raw.sections
    .filter((s: any) => s && s.heading)
    .slice(0, 12)
    .map((s: any) => {
      const out: ArtifactSection = { heading: String(s.heading).slice(0, 160) };
      if (typeof s.body === "string" && s.body.trim()) out.body = s.body.slice(0, 9000);
      if (Array.isArray(s.kpis)) out.kpis = s.kpis.filter((k: any) => k && (k.label || k.value)).slice(0, 8).map((k: any) => ({ label: String(k.label ?? "").slice(0, 60), value: String(k.value ?? "").slice(0, 40), hint: k.hint ? String(k.hint).slice(0, 80) : undefined }));
      if (Array.isArray(s.cards)) out.cards = s.cards.filter((c: any) => c && (c.title || c.body)).slice(0, 12).map((c: any) => ({ title: String(c.title ?? "").slice(0, 90), body: String(c.body ?? "").slice(0, 400) }));
      if (s.table && Array.isArray(s.table.columns) && s.table.columns.length) out.table = { columns: s.table.columns.map((c: any) => String(c).slice(0, 60)).slice(0, 12), rows: (Array.isArray(s.table.rows) ? s.table.rows : []).slice(0, 200).map((r: any) => (Array.isArray(r) ? r : [r]).map((c: any) => (typeof c === "number" ? c : String(c).slice(0, 200)))) };
      if (s.chart && (Array.isArray(s.chart.series) || Array.isArray(s.chart.values))) out.chart = { chart_kind: s.chart.chart_kind || s.chart.kind, title: s.chart.title ? String(s.chart.title).slice(0, 80) : undefined, categories: Array.isArray(s.chart.categories) ? s.chart.categories.map((c: any) => String(c).slice(0, 40)) : undefined, series: s.chart.series };
      return out;
    })
    .filter((s: ArtifactSection) => s.body || s.kpis || s.cards || s.table || s.chart);
  if (!sections.length) return null;
  return { title: String(raw.title || fallbackTitle).slice(0, 160), subtitle: raw.subtitle ? String(raw.subtitle).slice(0, 240) : undefined, sections };
}

// ===================== Orquestrador SÍNCRONO (bounded por deadline) =====================

export async function compileArtifact(opts: CompileOptions): Promise<CompileResult> {
  const t0 = Date.now();
  const remaining = () => (opts.deadlineMs ?? 240000) - (Date.now() - t0);
  const notes: string[] = [];
  const sources: ArtifactSource[] = [];
  const pushSources = (hits: SerpHit[]) => { for (const h of hits) { const url = String(h.link || "").trim(); if (/^https?:\/\//i.test(url) && !sources.some((s) => s.url === url)) sources.push({ title: String(h.title || "").slice(0, 180), url }); } };
  const phase = async (p: string, l: string) => { try { await opts.onPhase?.(p, l); } catch { /* */ } };
  const maxQueries = Math.max(0, Math.min(opts.maxQueries ?? 5, 8));
  const brief = String(opts.brief || "").trim();
  const inputs = opts.inputs || {};

  // Resolve o brain UMA vez (SSOT: mesma role do compositor do estudo). Sem isso → só render do que houver.
  const brain = await resolveRole(opts.sql, "mz_chat_brain");
  if (!brain) notes.push("Role SSOT mz_chat_brain não resolveu p/ modelo ativo — síntese degradada (só coleta).");

  // ── FASE 1: GATHER ──
  await phase("researching", "Coletando fontes e inputs…");
  // 1a) queries: usa as fornecidas; senão, se não há arquivos/dados, deriva do brief (1 call barata bounded).
  let queries: string[] = Array.isArray(inputs.web_queries) ? inputs.web_queries.filter((q) => q && String(q).trim()).map((q) => String(q).slice(0, 256)).slice(0, maxQueries) : [];
  const hasFiles = Array.isArray(inputs.file_paths) && inputs.file_paths.length > 0;
  const hasData = inputs.data != null && (typeof inputs.data !== "object" || Object.keys(inputs.data).length > 0);
  if (!queries.length && brain && !hasFiles && !hasData && brief && remaining() > 40000) {
    const qraw = await llmContent(brain, "Gere até 4 CONSULTAS de busca curtas, específicas e complementares p/ pesquisar o tema na web (dados atuais, números, fontes primárias). SOMENTE JSON {\"queries\":[\"...\"]}.", brief.slice(0, 1500), 800, 20000, 0.2);
    const qj = parseLlmJson(qraw); if (qj && Array.isArray(qj.queries)) queries = qj.queries.filter((q: any) => q && String(q).trim()).map((q: any) => String(q).slice(0, 256)).slice(0, maxQueries);
  }
  // 1b) web — SERP em paralelo (bounded). Captura as fontes REAIS.
  let webContext = "";
  if (queries.length && remaining() > 20000) {
    const hitsArr = await Promise.all(queries.map((q) => serpSearch(opts.sql, q)));
    hitsArr.forEach(pushSources);
    webContext = queries.map((q, i) => `# Busca: ${q}\n` + (hitsArr[i] || []).map((h, k) => `${k + 1}. ${h.title || ""}\n   ${h.link || ""}\n   ${String(h.snippet || "").slice(0, 260)}`).join("\n")).join("\n\n").slice(0, 9000);
  }
  // 1c) arquivos do workspace (via callback do dispatcher: mz-uploads + parseDocxToBlocks). Bounded.
  let fileContext = ""; let filesUsed = 0;
  if (hasFiles && opts.loadFile) {
    for (const p of inputs.file_paths!.slice(0, 5)) {
      if (remaining() < 20000) break;
      try { const f = await opts.loadFile(String(p)); if (f && f.text && f.text.trim()) { filesUsed++; fileContext += `\n\n# Arquivo: ${f.name}\n${f.text.slice(0, 6000)}`; } } catch { /* best-effort por arquivo */ }
    }
    fileContext = fileContext.slice(0, 14000);
  }
  // 1d) dados estruturados fornecidos direto.
  let dataContext = "";
  if (hasData) { try { dataContext = "\n\n# Dados fornecidos\n" + JSON.stringify(inputs.data).slice(0, 6000); } catch { /* */ } }

  const gathered = [webContext, fileContext, dataContext].filter(Boolean).join("\n\n").slice(0, 22000);
  const srcBlock = sources.length ? "\n\nFONTES REAIS COLETADAS (referencie no texto; a lista final é montada delas, NÃO invente URLs):\n" + sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}`).join("\n") : "";
  const fallbackTitle = String(opts.title || brief).slice(0, 120) || "Artefato";

  // ── FASE 2: SÍNTESE (bounded) ──
  let doc: ArtifactDoc | null = null;
  if (brain && remaining() > 25000) {
    await phase("generating", "Compondo o artefato…");
    const user = `PEDIDO:\n${brief}\n\nDADOS COLETADOS:\n${gathered || "(sem dados externos — componha a partir do pedido, sem inventar fatos)"}${srcBlock}`;
    // 2a) tentativa ESTRUTURADA (rica: seções + kpis/cards/table/chart). max_tokens ALTO (reasoning-model).
    const structRaw = await llmContent(brain, STRUCT_SYS, user, 8192, Math.min(Math.max(remaining() - 12000, 30000), 175000), 0.3);
    doc = sanitizeDoc(parseLlmJson(structRaw) || {}, fallbackTitle);
    // 2b) fallback PROSA (se o JSON falhar/vier vazio) — o compositor comprovado do estudo → markdown → doc.
    if (!doc && remaining() > 20000) {
      notes.push("Síntese estruturada falhou/vazia — fallback de prosa (markdown).");
      const proseRaw = await llmContent(brain, PROSE_SYS, user, 8192, Math.min(Math.max(remaining() - 8000, 25000), 150000), 0.3);
      if (proseRaw && proseRaw.trim().length > 120) doc = markdownToDoc(proseRaw, fallbackTitle);
    }
  }
  // 2c) degradado: sem brain ou sem tempo → doc mínimo a partir do que foi coletado (nunca falha por completo).
  if (!doc) {
    notes.push("Sem síntese LLM (brain indisponível ou deadline) — artefato mínimo a partir da coleta.");
    const secs: ArtifactSection[] = [];
    secs.push({ heading: "Pedido", body: brief.slice(0, 4000) });
    if (webContext) secs.push({ heading: "Resultados de pesquisa", body: webContext.slice(0, 6000) });
    if (fileContext) secs.push({ heading: "Inputs de arquivo", body: fileContext.slice(0, 6000) });
    doc = { title: fallbackTitle, subtitle: "Coleta bruta (síntese indisponível no orçamento de tempo)", sections: secs };
  }

  // ── FASE 3: RENDER ──
  await phase("rendering", "Montando a página…");
  const rendered = buildArtifactHtml(doc, sources, { compiledAt: new Date().toISOString().slice(0, 10) });
  return {
    html: rendered.html, title: doc.title, sections: rendered.toc, sources, charts: rendered.charts, notes,
    meta: { web_queries: queries.length, files_used: filesUsed, elapsed_ms: Date.now() - t0, model: brain?.model_slug, via: sources.length ? "serp" : undefined },
  };
}
