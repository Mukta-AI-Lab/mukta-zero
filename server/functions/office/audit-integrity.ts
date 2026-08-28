// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @module office/audit-integrity  (W2b do roadmap mz-document-evolution)
 * @description Motor SÍNCRONO e enxuto de AUDITORIA DE INTEGRIDADE de documentos para o MZ.
 * É o "oráculo de fato/citação" do MZ: verifica CITAÇÕES FABRICADAS (A) e CLAIMS SEM BASE (B)
 * via SERP — o dano dos escândalos Deloitte/KPMG — + FALÁCIAS (C, LLM-judge barato). Opcionais:
 * D=contradição interna (1 LLM global), E=estilometria (determinística, peso ~0, só triagem).
 *
 * Porte do produto principal (studio-composer/engines/audit-integrity.ts + _shared/integrity-dimensions.ts +
 * _shared/integrity-scorecard-xlsx.ts): COLAPSA o fluxo async start/analyze/verify/promote num LOOP SÍNCRONO
 * bounded por deadline (cabe no ~250s do edge). Princípio (runbook ai-content-integrity-detection):
 * auditar VERACIDADE, não AUTORIA — o "detector de IA" estilométrico (E) NUNCA é veredito (~70% falso-positivo).
 *
 * Aterramento no MZ (zero import do produto principal — edge single-file, tudo via ctx.sql):
 *   - SERP: cliente HMAC do MZ (mesmo de run-agent-chat: Vault SERP_CENTRAL_* central-first + local-fallback).
 *   - LLM SSOT: resolve role via llm_role_defaults×llm_models (base_url+provider_config), key via get_vault_secret.
 *     Roles novos (seed migration): integrity_extractor, integrity_factcheck (flash), integrity_judge.
 *   - XLSX: devolve XlsxSheet[] (aba Scorecard + 1 aba por dimensão); o mz-office monta com o buildXlsx provado.
 *   - Segmentação: determinística por regex (zero LLM), como o legal-redline-generator.
 *
 * Custo/latência: roles flash; top-N itens materiais por segmento; SERP em paralelo; dedup de citação;
 * nº de segmentos bounded; dimensões A/B/C default (D/E opt-in); deadline curto -> pontua o que deu tempo.
 */

// deno-lint-ignore no-explicit-any
type Sql = any;
// deno-lint-ignore no-explicit-any
type JsonRecord = Record<string, any>;

export type Dimension = "A" | "B" | "C" | "D" | "E";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface FindingItem {
  source_excerpt: string;
  cited_reference?: string;
  claim_text?: string;
  classification: string;
  severity: Severity;
  confidence: number;
  evidence?: string;
  source_quality?: string;
  recommendation: string;
  serp_top?: { title?: string; link?: string }[];
}
export interface WorkUnitResult {
  dimension: Dimension;
  items: FindingItem[];
}
export interface AuditFinding extends FindingItem {
  dimension: Dimension;
  segment_idx: number;
  segment_topic: string;
}

export interface XlsxSheet { name: string; columns: string[]; rows: (string | number)[][] }

export interface AuditResult {
  integrity_score: number;
  verdict: string;
  total_findings: number;
  dimensions: Dimension[];
  segments_audited: number;
  by_dimension: Record<string, { findings: number; critical: number; high: number; medium: number; low: number }>;
  top_issues: { dimension: string; severity: string; excerpt: string; recommendation: string }[];
  gate: { blocked: boolean; threshold: number; critical_count: number; reason: string };
  findings: AuditFinding[];
  sheets: XlsxSheet[];
  notes: string[];
}

// --- Labels / calibracao (espelha integrity-scorecard-xlsx.ts do produto) ---
export const DIMENSION_LABELS: Record<Dimension, string> = {
  A: "Citações fabricadas", B: "Claims sem base factual", C: "Falácias / silogismos",
  D: "Contradições internas", E: "Marcadores de IA",
};
const SEV_PENALTY: Record<Severity, number> = { critical: 20, high: 6, medium: 2, low: 0.5, info: 0 };
const SEV_LABEL: Record<Severity, string> = { critical: "Crítico", high: "Alto", medium: "Médio", low: "Baixo", info: "OK" };
export const DEFAULT_GATE_THRESHOLD = 70;

function clampStr(s: unknown, max: number): string { return String(s ?? "").trim().slice(0, max); }

// ===================== SERP (cliente HMAC do MZ - porte de run-agent-chat) =====================

async function signSerpBody(secret: string, body: string): Promise<{ ts: string; sig: string }> {
  const ts = new Date().toISOString();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${body}`));
  const sig = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { ts, sig };
}
// CENTRAL-FIRST -> LOCAL-FALLBACK (identico a run-agent-chat.callSerp). Vault via ctx.sql.
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
type SerpHit = { title?: string; link?: string; snippet?: string };
async function serpSearch(sql: Sql, query: string, timeoutMs = 15000): Promise<SerpHit[]> {
  try {
    const res = await callSerp(sql, "/v1/google/search", { query: query.slice(0, 256), gl: "br", hl: "pt-br", atomic: true }, timeoutMs);
    if (!res.ok) return [];
    return (res.data?.organic || []).slice(0, 5).map((o: any) => ({ title: o.title, link: o.link, snippet: o.snippet }));
  } catch { return []; }
}

// ===================== LLM SSOT (resolve role -> llm_models; key via Vault) =====================

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

// 1 chamada LLM -> JSON. Robusto (2 tentativas), timeout por chamada, temperatura baixa. Flash -> rapido.
async function llmJson(role: ResolvedRole, system: string, user: string, maxTokens = 3000, timeoutMs = 40000): Promise<JsonRecord | null> {
  const payload: JsonRecord = {
    model: role.model_slug, temperature: 0.1, max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    ...(role.provider_config ? { provider: role.provider_config } : {}),
  };
  for (let a = 1; a <= 2; a++) {
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await fetch(`${role.base_url.replace(/\/+$/, "")}/chat/completions`, { method: "POST", signal: ac.signal, headers: { "content-type": "application/json", authorization: `Bearer ${role.key}` }, body: JSON.stringify(payload) });
      const raw = await resp.text();
      if (resp.ok) {
        let content = "";
        try { content = JSON.parse(raw)?.choices?.[0]?.message?.content || ""; } catch { content = ""; }
        const p = parseLlmJson(content);
        if (p) return p;
      }
    } catch { /* retry */ } finally { clearTimeout(tm); }
    if (a < 2) await new Promise((s) => setTimeout(s, 500));
  }
  return null;
}

// ===================== Segmentacao deterministica (zero LLM) =====================

export interface Segment { idx: number; topic: string; text: string; revisable: boolean }
export function segmentText(text: string, maxLen = 6000): Segment[] {
  const paras = String(text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const segs: Segment[] = [];
  let buf = "";
  const flush = () => {
    const t = buf.trim();
    if (t.length > 0) {
      const topic = (t.split(/\n/)[0] || t).replace(/[#*_>`-]/g, "").trim().slice(0, 60) || `Trecho ${segs.length + 1}`;
      segs.push({ idx: segs.length, topic, text: t, revisable: t.length >= 60 });
    }
    buf = "";
  };
  for (const p of paras) {
    if (buf.length + p.length + 2 > maxLen && buf.length > 0) flush();
    buf += (buf ? "\n\n" : "") + p;
    if (buf.length >= maxLen) flush();
  }
  flush();
  if (segs.length === 0 && String(text || "").trim().length >= 60) {
    const t = String(text).trim();
    segs.push({ idx: 0, topic: t.slice(0, 60), text: t.slice(0, maxLen), revisable: true });
  }
  return segs;
}

// ===================== Dimensao A - Citacoes fabricadas (SemanticCite 4-classes) =====================

const CITATION_EXTRACT_SYS =
  "Você audita a INTEGRIDADE de documentos. Extraia do TRECHO toda REFERÊNCIA EXTERNA verificável: " +
  "papers/estudos acadêmicos, leis/normas, decisões judiciais, estatísticas atribuídas a uma fonte, " +
  "relatórios, livros, URLs e alegações atribuídas a uma organização/pessoa nomeada. " +
  "NÃO invente — extraia apenas o que ESTÁ literalmente no trecho. Responda SÓ JSON.";
const CITATION_CLASSIFY_SYS =
  "Você verifica CITAÇÕES usando os resultados de busca reais E o seu próprio conhecimento. " +
  "Classifique cada citação: 'supported' (a fonte existe e sustenta o uso), 'partially_supported' " +
  "(existe mas o uso exagera/distorce), 'unsupported' (a referência parece GENUINAMENTE FABRICADA — " +
  "paper/autor/decisão/estudo que não existe), 'uncertain' (busca inconclusiva e você não conhece a fonte). " +
  "REGRAS ANTI-FALSO-POSITIVO: leis, normas, súmulas e órgãos NOTÓRIOS que você reconhece " +
  "(ex.: Lei 8.078/CDC, LGPD, CVM, STF, FGV, Lei das S.A., Código Civil) são 'supported' mesmo se a busca " +
  "vier vazia — busca inconclusiva NÃO prova inexistência para fontes notórias. " +
  "REGRA DE RECALL DE FABRICAÇÃO (igualmente importante): para IDENTIFICADORES ESPECÍFICOS e checáveis — " +
  "título exato de artigo + autores + periódico + volume/páginas, número específico de processo/recurso " +
  "judicial (ex.: 'RE nº 1.998.776/SP'), código específico de relatório técnico (ex.: 'TR-4471') — se a " +
  "busca NÃO retorna NENHUM resultado correspondente àquele identificador específico, classifique como " +
  "'unsupported' (provável fabricação) com confidence ALTA (>=0.75). O benefício da dúvida é só para fontes " +
  "notórias, NÃO para identificadores específicos e inverificáveis. Responda SÓ JSON.";

async function auditCitations(sql: Sql, extractor: ResolvedRole, factcheck: ResolvedRole, segmentTextArg: string, maxCitations = 5): Promise<WorkUnitResult> {
  const extract = await llmJson(extractor, CITATION_EXTRACT_SYS,
    `[TRECHO]\n${segmentTextArg.slice(0, 12000)}\n\n[SAÍDA JSON]\n{"citations":[{"reference":"<a citação/referência exatamente como aparece>","excerpt":"<trecho LITERAL de UMA frase onde ela é usada>","kind":"<paper|lei|decisao|estatistica|relatorio|url|alegacao_terceiro|outro>"}]}\nSe não houver nenhuma referência externa verificável, devolva {"citations":[]}.`);
  const raw = Array.isArray(extract?.citations) ? extract!.citations as JsonRecord[] : [];
  const seen = new Set<string>();
  const citations = raw
    .map((c) => ({ reference: clampStr(c.reference, 400), excerpt: clampStr(c.excerpt, 600), kind: clampStr(c.kind, 40) }))
    .filter((c) => { if (c.reference.length < 6) return false; const k = c.reference.toLowerCase().slice(0, 120); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, maxCitations);
  if (citations.length === 0) return { dimension: "A", items: [] };

  const serp = await Promise.all(citations.map((c) => serpSearch(sql, c.reference)));
  const payload = citations.map((c, i) => ({ reference: c.reference, used_as: c.excerpt, kind: c.kind, serp: serp[i].map((o) => ({ title: o.title, snippet: o.snippet })) }));
  const classify = await llmJson(factcheck, CITATION_CLASSIFY_SYS,
    `[CITAÇÕES + EVIDÊNCIA DE BUSCA]\n${JSON.stringify(payload).slice(0, 11000)}\n\n[SAÍDA JSON]\n{"results":[{"reference":"<igual ao input>","classification":"supported|partially_supported|unsupported|uncertain","confidence":0.0,"evidence":"<o que a busca/fonte mostrou>","recommendation":"<manter / verificar / remover citação inexistente / corrigir atribuição>"}]}`, 3500);
  const cmap = new Map<string, JsonRecord>();
  for (const r of (Array.isArray(classify?.results) ? classify!.results as JsonRecord[] : [])) cmap.set(clampStr(r.reference, 400).toLowerCase().slice(0, 120), r);

  const items: FindingItem[] = citations.map((c, i) => {
    const r = cmap.get(c.reference.toLowerCase().slice(0, 120));
    const classification = clampStr(r?.classification, 40) || "uncertain"; // sem veredito -> nunca fabricacao por busca vazia
    const conf = Number(r?.confidence ?? 0.4) || 0.4;
    const sev: Severity = classification === "unsupported" ? (conf >= 0.7 ? "critical" : "high")
      : classification === "partially_supported" ? "medium"
      : classification === "uncertain" ? "low" : "info";
    return {
      source_excerpt: c.excerpt || c.reference, cited_reference: c.reference, classification, severity: sev, confidence: conf,
      evidence: clampStr(r?.evidence, 600) || (serp[i].length === 0 ? "Busca sem resultados (inconclusiva — não é prova de inexistência)." : undefined),
      recommendation: clampStr(r?.recommendation, 400) || (sev === "critical" ? "Referência provavelmente inexistente — confirmar ou remover." : sev === "high" ? "Não confirmada — verificar a fonte." : "Revisar a citação."),
      serp_top: serp[i].slice(0, 3).map((o) => ({ title: o.title, link: o.link })),
    };
  }).filter((it) => it.classification !== "supported");
  return { dimension: "A", items };
}

// ===================== Dimensao B - Claims materiais sem base (FActScore/MiniCheck + qualidade-fonte) =====================

const CLAIM_EXTRACT_SYS =
  "Você audita a INTEGRIDADE factual de documentos. Extraia do TRECHO apenas AFIRMAÇÕES FACTUAIS EMPÍRICAS " +
  "e verificáveis CONTRA O MUNDO REAL: dados/números de mercado, estatísticas, fatos históricos, eventos, " +
  "regulações específicas e alegações sobre entidades/pessoas nomeadas. " +
  "IGNORE (não extraia): opinião, recomendação, boilerplate, definições, e CLÁUSULAS CONTRATUAIS/declarações " +
  "de vontade e statements jurídico-normativos (ex.: 'as partes acordam') — isso não é fato empírico. " +
  "PRIORIDADE MÁXIMA (NÃO trate como opinião): afirmações apresentadas como FATO consumado/verdade mas " +
  "baseadas em RUMOR ou REDE SOCIAL ('segundo posts no Instagram/X', 'viralizou', 'dizem que', 'todo mundo " +
  "sabe', notícia não confirmada) — extraia-as SEMPRE, com materiality alta, pois são o caso mais perigoso " +
  "(boato tratado como verdade). Marque materiality e attributed_source (none/official/academic/press/social/rumor). Responda SÓ JSON.";
const CLAIM_GROUND_SYS =
  "Você verifica AFIRMAÇÕES factuais usando os resultados de busca E o seu conhecimento. Classifique cada uma: " +
  "'grounded' (fontes confiáveis sustentam, OU é fato amplamente conhecido do qual você tem convicção), " +
  "'ungrounded' (nenhuma fonte sustenta E você não a conhece, OU ela CONTRADIZ fatos conhecidos), " +
  "'weak_source' (só rumor/rede social/fórum sustenta — material relevante apoiado em fonte fraca). " +
  "Avalie a QUALIDADE da melhor fonte: official/academic/press/social/forum/none. " +
  "ANTI-FALSO-POSITIVO: busca vazia NÃO é prova de falsidade — se conhece o fato, marque 'grounded'; na dúvida " +
  "real prefira 'weak_source' a 'ungrounded'. Trate como grave afirmação material apoiada só em rede social como verdade. Responda SÓ JSON.";

async function auditClaims(sql: Sql, extractor: ResolvedRole, factcheck: ResolvedRole, segmentTextArg: string, maxClaims = 6): Promise<WorkUnitResult> {
  const extract = await llmJson(extractor, CLAIM_EXTRACT_SYS,
    `[TRECHO]\n${segmentTextArg.slice(0, 12000)}\n\n[SAÍDA JSON]\n{"claims":[{"claim":"<a afirmação factual, auto-contida>","excerpt":"<trecho LITERAL de UMA frase>","materiality":"high|medium|low","attributed_source":"<none|official|academic|press|social|rumor>"}]}\nSe não houver afirmação factual material, devolva {"claims":[]}.`);
  const raw = Array.isArray(extract?.claims) ? extract!.claims as JsonRecord[] : [];
  const claims = raw
    .map((c) => ({ claim: clampStr(c.claim, 400), excerpt: clampStr(c.excerpt, 600), materiality: clampStr(c.materiality, 20) || "medium", attributed: clampStr(c.attributed_source, 20) || "none" }))
    .filter((c) => c.claim.length > 10 && c.materiality !== "low")
    .slice(0, maxClaims);
  if (claims.length === 0) return { dimension: "B", items: [] };

  const serp = await Promise.all(claims.map((c) => serpSearch(sql, c.claim)));
  const payload = claims.map((c, i) => ({ claim: c.claim, materiality: c.materiality, attributed_source: c.attributed, serp: serp[i].map((o) => ({ title: o.title, link: o.link, snippet: o.snippet })) }));
  const ground = await llmJson(factcheck, CLAIM_GROUND_SYS,
    `[AFIRMAÇÕES + EVIDÊNCIA DE BUSCA]\n${JSON.stringify(payload).slice(0, 11000)}\n\n[SAÍDA JSON]\n{"results":[{"claim":"<igual ao input>","classification":"grounded|ungrounded|weak_source","source_quality":"official|academic|press|social|forum|none","confidence":0.0,"evidence":"<o que a busca mostrou>","recommendation":"<o que fazer>"}]}`, 3500);
  const gmap = new Map<string, JsonRecord>();
  for (const r of (Array.isArray(ground?.results) ? ground!.results as JsonRecord[] : [])) gmap.set(clampStr(r.claim, 400).toLowerCase().slice(0, 120), r);

  const items: FindingItem[] = claims.map((c, i) => {
    const r = gmap.get(c.claim.toLowerCase().slice(0, 120));
    const classification = clampStr(r?.classification, 40) || (serp[i].length === 0 ? "weak_source" : "grounded");
    const conf = Number(r?.confidence ?? 0.45) || 0.45;
    const matHigh = c.materiality === "high";
    const sev: Severity = classification === "ungrounded" ? (matHigh && conf >= 0.7 ? "critical" : "high")
      : classification === "weak_source" ? (matHigh ? "high" : "low") : "info";
    return {
      source_excerpt: c.excerpt || c.claim, claim_text: c.claim, classification, severity: sev, confidence: conf,
      evidence: clampStr(r?.evidence, 600) || (serp[i].length === 0 ? "Busca sem resultados (inconclusiva)." : undefined),
      source_quality: clampStr(r?.source_quality, 20) || (serp[i].length === 0 ? "none" : undefined),
      recommendation: clampStr(r?.recommendation, 400) || (sev === "info" ? "Afirmação sustentada." : "Buscar fonte primária ou suavizar a afirmação."),
      serp_top: serp[i].slice(0, 3).map((o) => ({ title: o.title, link: o.link })),
    };
  }).filter((it) => it.classification !== "grounded");
  return { dimension: "B", items };
}

// ===================== Dimensao C - Falacias (LLM-judge, sem SERP) =====================

const FALLACY_SYS =
  "Você é um lógico que audita o RACIOCÍNIO de documentos. Encontre no TRECHO falhas de raciocínio: " +
  "silogismo falho, raciocínio circular, non sequitur, falso dilema, post hoc (correlação como causa), " +
  "generalização indevida, salto de grandeza e apelo a autoridade/medo. Reporte só falhas REAIS e materiais " +
  "— não estilo nem preferência. Responda SÓ JSON.";
async function auditFallacies(judge: ResolvedRole, segmentTextArg: string): Promise<WorkUnitResult> {
  const judged = await llmJson(judge, FALLACY_SYS,
    `[TRECHO]\n${segmentTextArg.slice(0, 11000)}\n\n[SAÍDA JSON]\n{"fallacies":[{"type":"<nome da falácia>","excerpt":"<trecho LITERAL do argumento>","explanation":"<por que é falho>","severity":"high|medium|low"}]}\nSe o raciocínio for sólido, devolva {"fallacies":[]}.`, 2500);
  const raw = Array.isArray(judged?.fallacies) ? judged!.fallacies as JsonRecord[] : [];
  const items: FindingItem[] = raw.map((f) => {
    const sevRaw = clampStr(f.severity, 10);
    const severity: Severity = sevRaw === "high" ? "high" : sevRaw === "low" ? "low" : "medium";
    return { source_excerpt: clampStr(f.excerpt, 600), claim_text: clampStr(f.explanation, 400), classification: clampStr(f.type, 60) || "falácia", severity, confidence: 0.6, evidence: clampStr(f.explanation, 600), recommendation: "Reescrever o argumento com premissa->conclusão válidas ou remover a inferência." } as FindingItem;
  }).filter((it) => it.source_excerpt.length > 8);
  return { dimension: "C", items };
}

// ===================== Dimensao D - Contradicao interna (global, 1 LLM, sem SERP) =====================

const CONTRADICTION_SYS =
  "Você audita a CONSISTÊNCIA INTERNA de um documento. Procure: (1) CONTRADIÇÕES — duas afirmações em partes " +
  "diferentes que não podem ser ambas verdadeiras; (2) INCONSISTÊNCIAS NUMÉRICAS — números que não batem entre " +
  "seções/tabelas, somas/percentuais que não fecham. Reporte SOMENTE contradições/inconsistências REAIS e materiais. Responda SÓ JSON.";
async function auditContradictions(judge: ResolvedRole, documentText: string, claims: string[]): Promise<WorkUnitResult> {
  const claimsBlock = claims.length > 0 ? `\n\n[AFIRMAÇÕES JÁ EXTRAÍDAS DO DOC]\n${claims.slice(0, 30).map((c, i) => `${i + 1}. ${c}`).join("\n")}` : "";
  const judged = await llmJson(judge, CONTRADICTION_SYS,
    `[DOCUMENTO]\n${documentText.slice(0, 22000)}${claimsBlock}\n\n[SAÍDA JSON]\n{"contradictions":[{"type":"contradiction|numeric","statement_a":"<1ª afirmação LITERAL>","statement_b":"<2ª afirmação LITERAL conflitante>","explanation":"<por que conflitam / o número que não bate>","severity":"high|medium"}]}\nSe internamente consistente, devolva {"contradictions":[]}.`, 3000);
  const raw = Array.isArray(judged?.contradictions) ? judged!.contradictions as JsonRecord[] : [];
  const items: FindingItem[] = raw.map((c) => {
    const a = clampStr(c.statement_a, 400), b = clampStr(c.statement_b, 400);
    const sevRaw = clampStr(c.severity, 10);
    const severity: Severity = sevRaw === "high" ? "high" : sevRaw === "low" ? "low" : "medium";
    const kind = clampStr(c.type, 20) === "numeric" ? "numeric_inconsistency" : "contradiction";
    return { source_excerpt: (a && b) ? `${a}  <> ${b}` : (a || b), claim_text: clampStr(c.explanation, 400), classification: kind, severity, confidence: 0.6, evidence: clampStr(c.explanation, 600), recommendation: kind === "numeric_inconsistency" ? "Reconciliar os números entre as seções/tabelas." : "Resolver a contradição entre as afirmações." } as FindingItem;
  }).filter((it) => it.source_excerpt.length > 8);
  return { dimension: "D", items };
}

// ===================== Dimensao E - Estilometria (deterministica, zero LLM, peso ~0, so triagem) =====================

const AI_LEXICAL_MARKERS = ["ademais", "outrossim", "destarte", "vale ressaltar", "vale destacar", "é importante ressaltar", "é importante notar", "é crucial", "desempenha um papel", "desempenham um papel", "panorama", "robusto", "robusta", "aprimorar", "intrincad", "primordial", "meticulosa", "em suma", "por conseguinte", "cabe destacar", "tapeçaria", "multifacetad", "abrangente", "holístic", "no cenário atual", "navegar pelo", "mergulhar", "aprofundar-se", "em última análise", "delve", "intricate", "pivotal", "meticulous", "tapestry", "realm", "underscore", "showcasing"];
function auditStylometry(text: string): WorkUnitResult {
  const lower = (text || "").toLowerCase();
  const wordCount = ((text || "").match(/\S+/g) || []).length || 1;
  const hits: { term: string; n: number }[] = [];
  for (const m of AI_LEXICAL_MARKERS) { let n = 0, idx = lower.indexOf(m); while (idx !== -1) { n++; idx = lower.indexOf(m, idx + m.length); } if (n > 0) hits.push({ term: m, n }); }
  const markerCount = hits.reduce((s, h) => s + h.n, 0);
  const markerDensity = markerCount / (wordCount / 1000);
  const emDashes = ((text || "").match(/[—–]/g) || []).length;
  const emDashDensity = emDashes / (wordCount / 1000);
  const sentences = (text || "").split(/[.!?]+/).map((s) => (s.match(/\S+/g) || []).length).filter((n) => n > 2);
  let burstiness = 1;
  if (sentences.length >= 4) { const mean = sentences.reduce((a, b) => a + b, 0) / sentences.length; const variance = sentences.reduce((a, b) => a + (b - mean) ** 2, 0) / sentences.length; burstiness = Math.min(1, mean > 0 ? Math.sqrt(variance) / mean : 1); }
  const flags: string[] = [];
  if (markerDensity >= 3) flags.push(`${markerCount} marcadores léxicos típicos de IA (${hits.slice(0, 6).map((h) => h.term).join(", ")})`);
  if (emDashDensity >= 6) flags.push(`uso elevado de travessão (${emDashes} em ${wordCount} palavras)`);
  if (sentences.length >= 6 && burstiness < 0.35) flags.push(`frases muito uniformes em tamanho (baixa burstiness=${burstiness.toFixed(2)})`);
  if (flags.length === 0) return { dimension: "E", items: [] };
  return { dimension: "E", items: [{ source_excerpt: (text || "").slice(0, 200), classification: "lexical_flag", severity: "low", confidence: 0.3, evidence: flags.join("; "), recommendation: "TRIAGEM apenas (alto falso-positivo ~70% p/ não-nativos — Stanford/RAID): NÃO prova geração por IA nem afeta o score. Só prioriza a revisão factual (A/B)." }] };
}

// ===================== Scorecard (porte de integrity-scorecard-xlsx.ts -> XlsxSheet[] do mz-office) =====================

function verdictFor(score: number, hasCritical: boolean): string {
  if (hasCritical) return "REPROVADO — achados críticos (citação fabricada ou claim material sem base)";
  if (score >= 90) return "APROVADO — integridade alta";
  if (score >= 75) return "APROVADO COM RESSALVAS — revisar achados";
  if (score >= 50) return "ATENÇÃO — vários achados materiais";
  return "REPROVADO — integridade baixa";
}
function buildScorecard(sourceName: string, findings: AuditFinding[], dims: Dimension[], gateThreshold = DEFAULT_GATE_THRESHOLD) {
  let penalty = 0, hasCritical = false;
  const byDim: Record<string, { findings: number; critical: number; high: number; medium: number; low: number }> = {};
  for (const d of dims) byDim[d] = { findings: 0, critical: 0, high: 0, medium: 0, low: 0 };
  for (const it of findings) {
    if (it.dimension !== "E") penalty += SEV_PENALTY[it.severity] ?? 0;
    if (it.severity === "critical") hasCritical = true;
    const b = byDim[it.dimension] ?? (byDim[it.dimension] = { findings: 0, critical: 0, high: 0, medium: 0, low: 0 });
    b.findings++;
    if (it.severity === "critical") b.critical++; else if (it.severity === "high") b.high++; else if (it.severity === "medium") b.medium++; else if (it.severity === "low") b.low++;
  }
  const integrity_score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const verdict = verdictFor(integrity_score, hasCritical);
  const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];
  const top_issues = [...findings].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)).slice(0, 15)
    .map((it) => ({ dimension: DIMENSION_LABELS[it.dimension], severity: SEV_LABEL[it.severity], excerpt: it.source_excerpt, recommendation: it.recommendation }));

  const summaryRows: (string | number)[][] = [
    ["Documento", sourceName || "—"],
    ["Integrity Score (0-100)", integrity_score],
    ["Veredito", verdict],
    ["Total de achados", findings.length],
    ["Dimensões auditadas", dims.map((d) => `${d}=${DIMENSION_LABELS[d]}`).join(" · ")],
    ["", ""],
    ["Dimensão", "Achados / Crít / Alto / Méd / Baixo"],
  ];
  for (const d of dims) { const b = byDim[d]; summaryRows.push([`${d} — ${DIMENSION_LABELS[d]}`, `${b.findings} / ${b.critical} / ${b.high} / ${b.medium} / ${b.low}`]); }
  summaryRows.push(["", ""]);
  summaryRows.push(["Nota", "Auditoria de VERACIDADE (citações/claims), não de autoria. Marcadores estilísticos (E) não derrubam o score (alto falso-positivo)."]);

  const sheets: XlsxSheet[] = [{ name: "Scorecard", columns: ["Item", "Valor"], rows: summaryRows }];
  for (const d of dims) {
    const rows = findings.filter((it) => it.dimension === d).map((it) => [
      it.segment_idx, it.segment_topic, it.source_excerpt, it.cited_reference ?? it.claim_text ?? "",
      it.classification, SEV_LABEL[it.severity], typeof it.confidence === "number" ? it.confidence : "",
      it.source_quality ?? "", it.evidence ?? "", it.recommendation ?? "",
    ]) as (string | number)[][];
    sheets.push({ name: `${d} — ${DIMENSION_LABELS[d]}`.slice(0, 31), columns: ["Seg", "Tema", "Trecho do documento", "Citação / Afirmação", "Classificação", "Severidade", "Confiança", "Qualidade fonte", "Evidência", "Recomendação"], rows: rows.length > 0 ? rows : [["—", "—", "Nenhum achado nesta dimensão", "", "", "", "", "", "", ""]] });
  }
  const criticalCount = findings.filter((it) => it.severity === "critical" && (it.dimension === "A" || it.dimension === "B")).length;
  const blocked = integrity_score < gateThreshold || criticalCount > 0;
  const gateReason = criticalCount > 0 ? `${criticalCount} achado(s) crítico(s) factual(is) (citação fabricada / claim material sem base)` : (integrity_score < gateThreshold ? `integrity_score ${integrity_score} abaixo do limiar ${gateThreshold}` : "aprovado no gate");
  return { integrity_score, verdict, by_dimension: byDim, top_issues, sheets, gate: { blocked, threshold: gateThreshold, critical_count: criticalCount, reason: gateReason } };
}

// ===================== Orquestrador SINCRONO (bounded por deadline) =====================

export interface AuditOptions {
  sql: Sql;
  text: string;
  sourceName?: string;
  dimensions?: Dimension[];
  maxSegments?: number;
  segmentLen?: number;
  deadlineMs?: number;
  gateThreshold?: number;
}
const DEFAULT_DIMENSIONS: Dimension[] = ["A", "B", "C"];

export function parseDimensions(input: unknown): Dimension[] {
  if (!Array.isArray(input)) return DEFAULT_DIMENSIONS;
  const valid = input.map((d) => String(d).toUpperCase()).filter((d): d is Dimension => ["A", "B", "C", "D", "E"].includes(d));
  return valid.length > 0 ? Array.from(new Set(valid)) : DEFAULT_DIMENSIONS;
}

export async function runAuditIntegrity(opts: AuditOptions): Promise<AuditResult> {
  const t0 = Date.now();
  const notes: string[] = [];
  const dims = opts.dimensions && opts.dimensions.length ? Array.from(new Set(opts.dimensions)) : DEFAULT_DIMENSIONS;
  const deadlineMs = opts.deadlineMs ?? 200000;
  const maxSegments = Math.max(1, Math.min(opts.maxSegments ?? 4, 8));
  const gateThreshold = opts.gateThreshold ?? DEFAULT_GATE_THRESHOLD;

  const allSegments = segmentText(opts.text, opts.segmentLen ?? 6000).filter((s) => s.revisable);
  if (allSegments.length === 0) throw new Error("Nenhum segmento auditável (texto vazio ou < 60 caracteres úteis).");
  const segments = allSegments.slice(0, maxSegments);
  if (allSegments.length > segments.length) notes.push(`Documento truncado p/ auditoria: ${segments.length}/${allSegments.length} segmentos (deadline síncrono).`);

  // Resolve roles UMA vez (SSOT). Flash -> extractor/factcheck; judge um pouco mais forte.
  const [extractor, factcheck, judge] = await Promise.all([resolveRole(opts.sql, "integrity_extractor"), resolveRole(opts.sql, "integrity_factcheck"), resolveRole(opts.sql, "integrity_judge")]);
  if (!extractor || !factcheck || !judge) {
    const missing = [!extractor && "integrity_extractor", !factcheck && "integrity_factcheck", !judge && "integrity_judge"].filter(Boolean).join(", ");
    throw new Error(`Role(s) SSOT não resolvida(s) p/ modelo ativo (aplique a migration de seed): ${missing}`);
  }

  const perSegmentDims = dims.filter((d) => d !== "D"); // D e global (roda 1x no fim)
  const findings: AuditFinding[] = [];
  const push = (seg: Segment, unit: WorkUnitResult) => { for (const it of unit.items) findings.push({ ...it, dimension: unit.dimension, segment_idx: seg.idx, segment_topic: seg.topic }); };

  let audited = 0;
  for (const seg of segments) {
    if (Date.now() - t0 > deadlineMs) { notes.push(`Deadline atingido após ${audited} segmento(s) — pontuando o que foi auditado.`); break; }
    const jobs: Promise<WorkUnitResult>[] = [];
    if (perSegmentDims.includes("A")) jobs.push(auditCitations(opts.sql, extractor, factcheck, seg.text));
    if (perSegmentDims.includes("B")) jobs.push(auditClaims(opts.sql, extractor, factcheck, seg.text));
    if (perSegmentDims.includes("C")) jobs.push(auditFallacies(judge, seg.text));
    if (perSegmentDims.includes("E")) jobs.push(Promise.resolve(auditStylometry(seg.text)));
    const results = await Promise.allSettled(jobs);
    for (const r of results) if (r.status === "fulfilled") push(seg, r.value);
    audited++;
  }

  // D global (opt-in): 1 LLM sobre o documento + os claims de B ja extraidos.
  if (dims.includes("D") && Date.now() - t0 <= deadlineMs) {
    try {
      const bClaims = findings.filter((f) => f.dimension === "B").map((f) => String(f.claim_text ?? "")).filter(Boolean);
      const dUnit = await auditContradictions(judge, opts.text, bClaims);
      for (const it of dUnit.items) findings.push({ ...it, dimension: "D", segment_idx: -1, segment_topic: "Documento (global)" });
    } catch (e) { notes.push("D (contradição) falhou: " + String((e as Error).message || e).slice(0, 120)); }
  }

  const sc = buildScorecard(opts.sourceName || "documento", findings, dims, gateThreshold);
  return {
    integrity_score: sc.integrity_score, verdict: sc.verdict, total_findings: findings.length, dimensions: dims,
    segments_audited: audited, by_dimension: sc.by_dimension, top_issues: sc.top_issues, gate: sc.gate,
    findings, sheets: sc.sheets, notes,
  };
}
