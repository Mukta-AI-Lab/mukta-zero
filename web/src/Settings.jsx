// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import React, { useState, useEffect, useCallback } from "react";
import {
  Cpu, KeyRound, Loader2, RefreshCw, AlertTriangle, Check, X, Plus, Trash2,
  ShieldCheck, ShieldAlert, Coins, Server,
} from "lucide-react";
import { useT } from "./lib/i18n.jsx";

// Superfície de CONFIGURAÇÕES do usuário. Três abas: Modelos Mukta, Meus Modelos, Meus Provedores.
//
// O QUE A ABA "MODELOS MUKTA" **NÃO** MOSTRA, por decisão do Herbert: o padrão de escalonamento da
// Mukta. A ordem em que a plataforma tenta os provedores de um modelo aprovado (deepinfra →
// bitdeer, por exemplo) é decisão DA MUKTA, não do usuário — expor isso convidava a mexer no
// que não é dele e enchia a tela de controles que não são a pergunta dele. A pergunta dele é
// uma só: uso este modelo ou não. Então a aba é a lista dos aprovados com habilitar/desabilitar.
// (A coluna `rank` continua no banco e continua sendo a escada da Mukta; só não é exibida.)
//
// REGRAS que a tela precisa tornar visíveis:
//   · REVISADO pela Mukta = existe em llm_models com is_active. O usuário só habilita ou
//     desabilita; não acrescenta (o backend rejeita — negativo N1).
//   · CHAVE PRÓPRIA = o catálogo não limita, mas exige chave do provedor E consent de risco
//     registrado (negativos N3 e N4).
// Nenhum slug é hardcodado: tudo vem de mz_my_models, que lê llm_models — o Admin da Mukta
// segue sendo o Single Source of Truth.

// Provedores que o usuario pode cadastrar com a PROPRIA chave. Lista FECHADA: campo livre
// convidava a digitar um provedor que a plataforma nao sabe chamar. O slug segue a convencao
// minúscula do catálogo (llm_models.provider). `local` é infra do próprio usuário compatível
// com a API da OpenAI — e é o único que exige endpoint, porque só ele não tem um conhecido.
const PROVIDERS = [
  { slug: "openrouter", label: "OpenRouter" },
  { slug: "nebius", label: "Nebius" },
  { slug: "deepinfra", label: "DeepInfra" },
  { slug: "bitdeer", label: "BitDeer" },
  { slug: "deepseek", label: "DeepSeek" },
  { slug: "anthropic", label: "Anthropic" },
  { slug: "gemini", label: "Gemini" },
  { slug: "kimi", label: "Kimi" },
  { slug: "openai", label: "OpenAI" },
  { slug: "local", label: "Local (compatível com a API da OpenAI)", needsUrl: true },
];
const providerLabel = (slug) => (PROVIDERS.find((x) => x.slug === slug) || {}).label || slug;

const CONSENT_SCOPE = "unreviewed_models";
const CONSENT_VERSION = "v1";

const STRINGS = {
  pt: {
    title: "Configurações", sub: "Modelos e provedores.",
    tabMukta: "Modelos Mukta", tabMine: "Meus Modelos", tabProviders: "Meus Provedores",
    refresh: "Atualizar", loading: "Carregando…", loadFail: "Não foi possível carregar as configurações.",
    secModelsSub: "Habilite os modelos que o Mukta Zero pode usar no seu trabalho. Desabilitar um modelo o retira das escolhas do agente.",
    secKeysSub: "Sua chave é gravada cifrada e nunca volta para o navegador.",
    reviewed: "Aprovados pela Mukta", reviewedHint: "Catálogo aprovado — você habilita o que quer usar, não é possível acrescentar aqui.",
    unreviewed: "Seus modelos (não revisados)", unreviewedHint: "Disponíveis porque você forneceu a chave do provedor. A Mukta não os revisou.",
    enabled: "Em uso", disabled: "Desligado", enabledCount: (k, n) => `${k} de ${n} em uso`,
    key: "Chave", keyPlaceholder: "Cole a chave do provedor", saving: "Salvando…",
    remove: "Remover", creditOrder: "Ordem de cobrança", muktaFirst: "Créditos Mukta primeiro",
    providerFirst: "Meu provedor primeiro", creditHint: "Define quem paga a chamada primeiro quando as duas formas existem.",
    addProvider: "Adicionar provedor", provider: "Provedor", pickProvider: "Escolha o provedor", baseUrl: "URL do endpoint", baseUrlHint: "Ex.: http://localhost:8000/v1 — precisa ser compatível com a API da OpenAI",
    addModel: "Adicionar modelo", modelSlug: "Identificador do modelo no provedor",
    needKey: "Cadastre a chave de um provedor na aba Meus Provedores para adicionar modelos próprios.",
    noKeys: "Nenhum provedor com chave própria ainda.", noneOwn: "Você ainda não adicionou modelos próprios.",
    consentTitle: "Modelos não revisados pela Mukta",
    consentAccept: "Entendo os riscos e assumo a responsabilidade",
    consentCancel: "Cancelar", consentDone: "Risco aceito",
  },
  en: {
    title: "Settings", sub: "Models and providers.",
    tabMukta: "Mukta Models", tabMine: "My Models", tabProviders: "My Providers",
    refresh: "Refresh", loading: "Loading…", loadFail: "Couldn't load settings.",
    secModelsSub: "Enable the models Mukta Zero may use in your work. Disabling a model removes it from the agent's choices.",
    secKeysSub: "Your key is stored encrypted and never returns to the browser.",
    reviewed: "Approved by Mukta", reviewedHint: "Approved catalog — you enable what you want to use, you cannot add here.",
    unreviewed: "Your models (not reviewed)", unreviewedHint: "Available because you supplied the provider key. Mukta has not reviewed them.",
    enabled: "In use", disabled: "Off", enabledCount: (k, n) => `${k} of ${n} in use`,
    key: "Key", keyPlaceholder: "Paste the provider key", saving: "Saving…",
    remove: "Remove", creditOrder: "Billing order", muktaFirst: "Mukta credits first",
    providerFirst: "My provider first", creditHint: "Sets who pays for the call first when both are available.",
    addProvider: "Add provider", provider: "Provider", pickProvider: "Pick the provider", baseUrl: "Endpoint URL", baseUrlHint: "e.g. http://localhost:8000/v1 — must be OpenAI-API compatible",
    addModel: "Add model", modelSlug: "Model identifier at the provider",
    needKey: "Register a provider key in the My Providers tab to add your own models.",
    noKeys: "No provider with your own key yet.", noneOwn: "You haven't added your own models yet.",
    consentTitle: "Models not reviewed by Mukta",
    consentAccept: "I understand the risks and accept responsibility",
    consentCancel: "Cancel", consentDone: "Risk accepted",
  },
  es: {
    title: "Configuración", sub: "Modelos y proveedores.",
    tabMukta: "Modelos Mukta", tabMine: "Mis Modelos", tabProviders: "Mis Proveedores",
    refresh: "Actualizar", loading: "Cargando…", loadFail: "No se pudo cargar la configuración.",
    secModelsSub: "Habilita los modelos que Mukta Zero puede usar en tu trabajo. Desactivar un modelo lo retira de las opciones del agente.",
    secKeysSub: "Tu clave se guarda cifrada y nunca vuelve al navegador.",
    reviewed: "Aprobados por Mukta", reviewedHint: "Catálogo aprobado — habilitas lo que quieres usar, no puedes añadir aquí.",
    unreviewed: "Tus modelos (no revisados)", unreviewedHint: "Disponibles porque aportaste la clave del proveedor. Mukta no los revisó.",
    enabled: "En uso", disabled: "Apagado", enabledCount: (k, n) => `${k} de ${n} en uso`,
    key: "Clave", keyPlaceholder: "Pega la clave del proveedor", saving: "Guardando…",
    remove: "Quitar", creditOrder: "Orden de cobro", muktaFirst: "Créditos Mukta primero",
    providerFirst: "Mi proveedor primero", creditHint: "Define quién paga la llamada primero cuando ambas existen.",
    addProvider: "Añadir proveedor", provider: "Proveedor", pickProvider: "Elige el proveedor", baseUrl: "URL del endpoint", baseUrlHint: "ej.: http://localhost:8000/v1 — debe ser compatible con la API de OpenAI",
    addModel: "Añadir modelo", modelSlug: "Identificador del modelo en el proveedor",
    needKey: "Registra una clave en la pestaña Mis Proveedores para añadir tus modelos.",
    noKeys: "Aún no hay proveedor con clave propia.", noneOwn: "Aún no añadiste modelos propios.",
    consentTitle: "Modelos no revisados por Mukta",
    consentAccept: "Entiendo los riesgos y asumo la responsabilidad",
    consentCancel: "Cancelar", consentDone: "Riesgo aceptado",
  },
};

// TEXTO DO TERMO — versionado; o sha256 do que foi EXIBIDO é gravado junto do aceite, senão
// "o usuário aceitou" não diz aceitou o quê e o consent não é auditável.
const CONSENT_TEXT = {
  pt: `Modelos não revisados pela Mukta

Ao habilitar um modelo que a Mukta não revisou, você assume que:

1. A Mukta não avaliou a qualidade, a segurança, o viés nem a estabilidade deste modelo, e não responde pelo que ele produzir.
2. As chamadas usam a SUA chave e são cobradas na SUA conta do provedor. Custo, limites de uso e eventual bloqueio são entre você e o provedor.
3. O conteúdo que você enviar sai da infraestrutura da Mukta e passa a ser regido pela política de privacidade e de retenção do provedor que você escolheu — inclusive quanto a treinamento com os seus dados.
4. As salvaguardas que a Mukta aplica aos modelos aprovados podem não valer aqui, e a saída pode ser incorreta, ofensiva ou inadequada ao seu caso.
5. A responsabilidade pelo uso do resultado é sua, inclusive quanto a obrigações legais, regulatórias e contratuais da sua atividade.

Você pode remover o modelo ou apagar a chave a qualquer momento. Apagar a chave desabilita automaticamente os modelos daquele provedor.`,
  en: `Models not reviewed by Mukta

By enabling a model Mukta has not reviewed, you accept that:

1. Mukta has not assessed this model's quality, safety, bias or stability, and is not answerable for what it produces.
2. Calls use YOUR key and are billed to YOUR provider account. Cost, rate limits and any suspension are between you and the provider.
3. Content you send leaves Mukta's infrastructure and becomes subject to the privacy and retention policy of the provider you chose — including whether your data is used for training.
4. Safeguards Mukta applies to approved models may not apply here, and output may be incorrect, offensive or unsuitable for your case.
5. Responsibility for using the output is yours, including legal, regulatory and contractual duties of your activity.

You may remove the model or delete the key at any time. Deleting the key automatically disables that provider's models.`,
  es: `Modelos no revisados por Mukta

Al habilitar un modelo que Mukta no revisó, aceptas que:

1. Mukta no evaluó la calidad, seguridad, sesgo ni estabilidad de este modelo, y no responde por lo que produzca.
2. Las llamadas usan TU clave y se cobran a TU cuenta del proveedor. Costo, límites y cualquier bloqueo son entre tú y el proveedor.
3. El contenido que envíes sale de la infraestructura de Mukta y queda regido por la política de privacidad y retención del proveedor que elegiste — incluido el uso de tus datos para entrenamiento.
4. Las salvaguardas que Mukta aplica a los modelos aprobados pueden no aplicar aquí, y la salida puede ser incorrecta, ofensiva o inadecuada para tu caso.
5. La responsabilidad por el uso del resultado es tuya, incluidas obligaciones legales, regulatorias y contractuales de tu actividad.

Puedes quitar el modelo o borrar la clave en cualquier momento. Borrar la clave desactiva automáticamente los modelos de ese proveedor.`,
};

async function sha256(text) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return "sha256-indisponivel"; }
}

const Card = ({ children, className = "" }) => (
  <div className={`rounded-xl border border-border bg-surface ${className}`}>{children}</div>
);

export default function Settings({ supabase, lang = "pt" }) {
  const t = useT(STRINGS);
  const [tab, setTab] = useState("mukta");
  const [models, setModels] = useState([]);
  const [keys, setKeys] = useState([]);
  const [consented, setConsented] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [consentOpen, setConsentOpen] = useState(null);
  const [newKey, setNewKey] = useState({ provider: "", key: "", baseUrl: "" });
  const [newModel, setNewModel] = useState({ provider: "", slug: "" });

  const reload = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const [m, k, c] = await Promise.all([
        supabase.rpc("mz_my_models"),
        supabase.rpc("mz_my_provider_keys"),
        supabase.from("mz_user_risk_consents").select("doc_version").eq("scope", CONSENT_SCOPE).limit(1),
      ]);
      if (m.error) throw m.error;
      if (k.error) throw k.error;
      setModels(m.data || []);
      setKeys(k.data || []);
      setConsented(!!(c.data && c.data.length));
    } catch (e) {
      // Leitor não nasce mudo: falha de carga não pode parecer "não há nada configurado".
      console.error("Configurações: falha ao carregar", e);
      setErr(`${t.loadFail} ${e?.message || ""}`.trim());
    } finally { setLoading(false); }
  }, [supabase, t.loadFail]);

  useEffect(() => { reload(); }, [reload]);

  // NOME LIMPO. O `display_name` do catálogo carrega anotação OPERACIONAL da Mukta —
  // "(OpenRouter → Baidu fp8, fallback só dentro de fp8)", "— fallback do deepinfra, mesmo
  // modelo", "(Moonshot — diversidade)". Isso é útil no Admin e impróprio aqui: conta ao
  // usuário como a Mukta arranja os provedores por dentro, que não é assunto dele. Corto no
  // primeiro "(", "—" ou " - "; se não sobrar nada, caio no slug. NÃO altero o dado — a
  // anotação continua no catálogo para quem opera a plataforma.
  const cleanName = (m) => {
    const cut = String(m.display_name || "").trim().split(/\s*[(—]|\s+-\s+/)[0].trim();
    if (cut) return cut;
    const seg = String(m.model_slug || "").split("/").pop() || String(m.model_slug || "");
    return seg.replace(/[-_]+/g, " ").trim();
  };

  // Ordena por nome e depois por provedor. Não pelo rank: o rank é a escada da Mukta e não é
  // assunto desta tela.
  const byName = (a, b) =>
    cleanName(a).localeCompare(cleanName(b)) || String(a.provider).localeCompare(String(b.provider));
  const approved = models.filter((m) => m.in_catalog).sort(byName);
  const own = models.filter((m) => !m.in_catalog).sort(byName);
  const keyOf = (r) => `${r.provider}|${r.model_slug}`;

  async function toggle(row) {
    const enabled = !row.enabled;
    setBusy(keyOf(row));
    setModels((p) => p.map((x) => (keyOf(x) === keyOf(row) ? { ...x, enabled } : x)));
    try {
      if (row.llm_model_id) {
        const { error } = await supabase.rpc("mz_set_model_pref", { p_llm_model_id: row.llm_model_id, p_enabled: enabled });
        if (error) throw error;
      }
    } catch (e) { setErr(String(e?.message || e)); await reload(); } finally { setBusy(""); }
  }

  async function saveKey() {
    if (!newKey.provider || newKey.key.trim().length < 8) return;
    setBusy("key");
    try {
      const { error } = await supabase.rpc("mz_set_provider_key", {
        p_provider: newKey.provider, p_key: newKey.key.trim(), p_credit_order: "mukta_first",
        p_base_url: newKey.baseUrl.trim() || null,
      });
      if (error) throw error;
      setNewKey({ provider: "", key: "", baseUrl: "" });
      await reload();
    } catch (e) { setErr(String(e?.message || e)); } finally { setBusy(""); }
  }

  async function setCreditOrder(provider, order) {
    setKeys((p) => p.map((k) => (k.provider === provider ? { ...k, credit_order: order } : k)));
    try {
      const { error } = await supabase.rpc("mz_set_credit_order", { p_provider: provider, p_credit_order: order });
      if (error) throw error;
    } catch (e) { setErr(String(e?.message || e)); await reload(); }
  }

  async function deleteKey(provider) {
    setBusy("del:" + provider);
    try {
      const { error } = await supabase.rpc("mz_delete_provider_key", { p_provider: provider });
      if (error) throw error;
      await reload();
    } catch (e) { setErr(String(e?.message || e)); } finally { setBusy(""); }
  }

  async function removeOwn(row) {
    setBusy("rm:" + keyOf(row));
    try {
      const { error } = await supabase.rpc("mz_remove_custom_model", { p_provider: row.provider, p_model_slug: row.model_slug });
      if (error) throw error;
      await reload();
    } catch (e) { setErr(String(e?.message || e)); } finally { setBusy(""); }
  }

  async function addCustomModel() {
    if (!newModel.provider || !newModel.slug.trim()) return;
    const doIt = async () => {
      setBusy("addmodel");
      try {
        const { error } = await supabase.rpc("mz_add_custom_model", {
          p_provider: newModel.provider, p_model_slug: newModel.slug.trim(), p_display_name: null,
        });
        if (error) throw error;
        setNewModel({ provider: newModel.provider, slug: "" });
        await reload();
      } catch (e) { setErr(String(e?.message || e)); } finally { setBusy(""); }
    };
    // O backend também rejeita sem consent (N4), mas deixar o usuário bater na parede para
    // descobrir seria má tela: o termo aparece antes.
    if (!consented) { setConsentOpen({ onAccept: doIt }); return; }
    await doIt();
  }

  async function acceptConsent() {
    setBusy("consent");
    try {
      const text = CONSENT_TEXT[lang] || CONSENT_TEXT.pt;
      const { error } = await supabase.rpc("mz_record_consent", {
        p_scope: CONSENT_SCOPE, p_doc_version: CONSENT_VERSION, p_doc_sha256: await sha256(text),
      });
      if (error) throw error;
      setConsented(true);
      const cb = consentOpen?.onAccept;
      setConsentOpen(null);
      if (cb) await cb();
    } catch (e) { setErr(String(e?.message || e)); } finally { setBusy(""); }
  }

  // Uma linha por modelo aprovado. Uma pergunta só: uso ou não uso.
  const ModelRow = ({ m, onRemove }) => (
    <li className="flex items-center gap-3 px-3.5 py-2.5">
      {/* Somente MODELO e PROVEDOR. Para os modelos do próprio usuário mostro também o slug,
          porque foi ele quem o digitou e é como ele identifica o que cadastrou. */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{cleanName(m)}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {m.provider}
          {!m.in_catalog && <span className="font-mono"> · {m.model_slug}</span>}
        </p>
      </div>
      <button onClick={() => toggle(m)} disabled={busy === keyOf(m)} aria-pressed={m.enabled}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-60 ${
          m.enabled ? "border-primary/30 bg-primary-soft text-primary" : "border-border bg-surface-2 text-muted-foreground"
        }`}>
        {busy === keyOf(m) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : m.enabled ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        {m.enabled ? t.enabled : t.disabled}
      </button>
      {onRemove && (
        <button onClick={() => onRemove(m)} disabled={busy === "rm:" + keyOf(m)} title={t.remove} aria-label={`${t.remove} ${m.model_slug}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-destructive disabled:opacity-50">
          {busy === "rm:" + keyOf(m) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      )}
    </li>
  );

  const tabBtn = (id, label) => (
    <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
        tab === id ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
      }`}>
      {label}
    </button>
  );

  const nOn = approved.filter((m) => m.enabled).length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">{t.title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t.sub}</p>
        </div>
        <button onClick={reload} disabled={loading}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-2 disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />{t.refresh}
        </button>
      </header>

      <div className="flex items-center gap-1 border-b border-border pb-2" role="tablist">
        {tabBtn("mukta", t.tabMukta)}
        {tabBtn("mine", own.length ? t.tabMine + " (" + own.length + ")" : t.tabMine)}
        {tabBtn("providers", `${t.tabProviders}${keys.length ? ` (${keys.length})` : ""}`)}
      </div>

      {err && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{err}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3" role="status" aria-label={t.loading}>
          {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2/60" />)}
        </div>
      ) : tab === "mukta" ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">{t.secModelsSub}</p>
          </div>

          <Card>
            <div className="flex items-center gap-2 border-b border-border px-3.5 py-2">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">{t.reviewed}</span>
              <span className="truncate text-[11px] text-muted-foreground">· {t.reviewedHint}</span>
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{t.enabledCount(nOn, approved.length)}</span>
            </div>
            <ul className="divide-y divide-border">
              {approved.map((m) => <ModelRow key={m.llm_model_id} m={m} />)}
            </ul>
          </Card>
        </section>
      ) : tab === "mine" ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">{t.unreviewedHint}</p>
          </div>
          <Card>
            <div className="flex items-center gap-2 border-b border-border px-3.5 py-2">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">{t.unreviewed}</span>
              <span className="truncate text-[11px] text-muted-foreground">· {t.unreviewedHint}</span>
              {consented && (
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                  <Check className="h-3 w-3" aria-hidden="true" />{t.consentDone}
                </span>
              )}
            </div>
            {own.length > 0
              ? <ul className="divide-y divide-border">{own.map((m) => <ModelRow key={keyOf(m)} m={m} onRemove={removeOwn} />)}</ul>
              : <p className="px-3.5 pt-3 text-xs text-muted-foreground">{t.noneOwn}</p>}
            <div className="flex flex-wrap items-end gap-2 px-3.5 py-3">
              {keys.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t.needKey}</p>
              ) : (
                <>
                  <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                    {t.provider}
                    <select value={newModel.provider} onChange={(e) => setNewModel((s) => ({ ...s, provider: e.target.value }))}
                      className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground">
                      <option value="">—</option>
                      {keys.map((k) => <option key={k.provider} value={k.provider}>{providerLabel(k.provider)}</option>)}
                    </select>
                  </label>
                  <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
                    {t.modelSlug}
                    <input value={newModel.slug} onChange={(e) => setNewModel((s) => ({ ...s, slug: e.target.value }))}
                      placeholder="ex.: meta-llama/Llama-3.3-70B-Instruct"
                      className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:border-border-strong" />
                  </label>
                  <button onClick={addCustomModel} disabled={!newModel.provider || !newModel.slug.trim() || busy === "addmodel"}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50">
                    {busy === "addmodel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}{t.addModel}
                  </button>
                </>
              )}
            </div>
          </Card>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">{t.secKeysSub}</p>
          </div>
          <Card>
            {keys.length === 0 ? (
              <p className="px-3.5 py-6 text-center text-xs text-muted-foreground">{t.noKeys}</p>
            ) : (
              <ul className="divide-y divide-border">
                {keys.map((k) => (
                  <li key={k.provider} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                    <Server className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{providerLabel(k.provider)}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">•••• {k.last4}{k.base_url ? ` · ${k.base_url}` : ""}</p>
                    </div>
                    <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-0.5" role="group" aria-label={t.creditOrder} title={t.creditHint}>
                      {[["mukta_first", t.muktaFirst, Coins], ["provider_first", t.providerFirst, Server]].map(([val, label, Ico]) => (
                        <button key={val} onClick={() => setCreditOrder(k.provider, val)} aria-pressed={k.credit_order === val}
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                            k.credit_order === val ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                          }`}>
                          <Ico className="h-3 w-3" aria-hidden="true" />{label}
                        </button>
                      ))}
                    </div>
                    <button onClick={() => deleteKey(k.provider)} disabled={busy === "del:" + k.provider}
                      title={t.remove} aria-label={`${t.remove} ${k.provider}`}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-destructive disabled:opacity-50">
                      {busy === "del:" + k.provider ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2 border-t border-border px-3.5 py-3">
              {/* Lista FECHADA: um campo livre convidava a digitar um provedor que a plataforma
                  não sabe chamar. Provedores já cadastrados saem da lista — cadastrar duas vezes
                  o mesmo seria substituir a chave sem o usuário perceber. */}
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                {t.provider}
                <select value={newKey.provider} onChange={(e) => setNewKey((s) => ({ ...s, provider: e.target.value, baseUrl: "" }))}
                  className="w-56 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground focus:outline-none focus-visible:border-border-strong">
                  <option value="">{t.pickProvider}</option>
                  {PROVIDERS.filter((pv) => !keys.some((k) => k.provider === pv.slug))
                    .map((pv) => <option key={pv.slug} value={pv.slug}>{pv.label}</option>)}
                </select>
              </label>
              <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
                {t.key}
                <input type="password" autoComplete="off" value={newKey.key} onChange={(e) => setNewKey((s) => ({ ...s, key: e.target.value }))}
                  placeholder={t.keyPlaceholder}
                  className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:border-border-strong" />
              </label>
              {/* Só `local` pede endpoint — os demais a plataforma já sabe onde chamar. O backend
                  também exige (e valida o esquema http/https), mas pedir aqui evita o erro. */}
              {PROVIDERS.find((pv) => pv.slug === newKey.provider)?.needsUrl && (
                <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
                  {t.baseUrl}
                  <input value={newKey.baseUrl} onChange={(e) => setNewKey((s) => ({ ...s, baseUrl: e.target.value }))}
                    placeholder="http://localhost:8000/v1" title={t.baseUrlHint}
                    className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:border-border-strong" />
                </label>
              )}
              <button onClick={saveKey}
                disabled={!newKey.provider || newKey.key.trim().length < 8 || busy === "key"
                  || (PROVIDERS.find((pv) => pv.slug === newKey.provider)?.needsUrl && !newKey.baseUrl.trim())}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50">
                {busy === "key" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {busy === "key" ? t.saving : t.addProvider}
              </button>
            </div>
          </Card>
        </section>
      )}

      {consentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade-in">
          <div role="dialog" aria-modal="true" aria-label={t.consentTitle}
            className="flex max-h-[85dvh] w-full max-w-2xl flex-col rounded-2xl border border-warning/30 bg-card shadow-modal">
            <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
              <h3 className="text-base font-semibold text-foreground">{t.consentTitle}</h3>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{CONSENT_TEXT[lang] || CONSENT_TEXT.pt}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
              <button onClick={() => setConsentOpen(null)}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                {t.consentCancel}
              </button>
              <button onClick={acceptConsent} disabled={busy === "consent"}
                className="inline-flex items-center gap-2 rounded-lg bg-warning px-3 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60">
                {busy === "consent" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                {t.consentAccept}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
