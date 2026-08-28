// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import { useState, useEffect } from "react";
import { UserCog, X, Check, Loader2, Sparkles, Wand2, Trash2 } from "lucide-react";
import { useT } from "./lib/i18n.jsx";
import config from "./config.js";

// Nível 1: templates de profissão (system personas seedadas na .107). Nível 2: descrição fluida → compilada.
//
// F-3 (defeito corrigido): esta tela era WRITE-ONLY. `mz_user_persona` só recebia upsert e nunca era
// LIDA — o usuário escolhia uma persona, via um ✓ verde, e ao reabrir o modal encontrava a grade de
// templates sem nenhuma marca de qual estava ativa. Não havia como saber, trocar com consciência ou
// reverter. Isso contradizia a tese da Rota A que o próprio projeto defende ("auditável/reversível: é
// TEXTO, diff+rollback") — a vantagem da rota escolhida estava não-entregue por falta de superfície.
// Agora: leitura ao abrir + estado ativo visível na grade + remoção (rollback ao padrão).

const TEMPLATES = [
  { slug: "sw_engineer", label: "Engenheiro de Software", desc: "Código correto, testado por execução e legível." },
  { slug: "developer", label: "Desenvolvedor", desc: "Entrega o que roda, itera rápido (MVP-first)." },
  { slug: "researcher", label: "Pesquisador", desc: "Fundamenta em fontes reais; quantifica incerteza." },
  { slug: "lawyer", label: "Advogado", desc: "Precisão jurídica; jamais fabrica citação." },
  { slug: "doc_specialist", label: "Especialista de Documentação", desc: "Clareza, estrutura e exemplos concretos." },
  { slug: "mech_engineer", label: "Engenheiro Mecânico", desc: "Cálculo rigoroso, normas e margens de segurança." },
];

const STRINGS = {
  pt: { title: "Persona do agente", sub: "Escolha uma profissão ou descreva a sua.", tab1: "Templates", tab2: "Criar do zero",
        ph: "Ex.: um advogado trabalhista que escreve em linguagem simples, cita a CLT e nunca inventa precedente.",
        create: "Criar persona", creating: "Compilando…", goals: "Objetivos", empty: "Descreva a persona.", fail: "Não consegui compilar — tente detalhar mais.",
        loading: "Carregando sua persona…", activeNow: "Persona ativa", none: "Nenhuma persona ativa — o Mukta Zero usa o comportamento padrão.",
        custom: "Persona personalizada", remove: "Remover", removing: "Removendo…", removeFail: "Não consegui remover a persona.", activeBadge: "ativa", readFail: "Não foi possível ler a persona ativa." },
  en: { title: "Agent persona", sub: "Pick a profession or describe your own.", tab1: "Templates", tab2: "From scratch",
        ph: "e.g. a labor lawyer who writes plainly, cites the law, never invents precedent.",
        create: "Create persona", creating: "Compiling…", goals: "Objectives", empty: "Describe the persona.", fail: "Couldn't compile — add more detail.",
        loading: "Loading your persona…", activeNow: "Active persona", none: "No active persona — Mukta Zero uses its default behavior.",
        custom: "Custom persona", remove: "Remove", removing: "Removing…", removeFail: "Couldn't remove the persona.", activeBadge: "active", readFail: "Couldn't read the active persona." },
  es: { title: "Persona del agente", sub: "Elige una profesión o describe la tuya.", tab1: "Plantillas", tab2: "Desde cero",
        ph: "ej.: un abogado laboral que escribe claro, cita la ley y nunca inventa precedentes.",
        create: "Crear persona", creating: "Compilando…", goals: "Objetivos", empty: "Describe la persona.", fail: "No pude compilar — añade más detalle.",
        loading: "Cargando tu persona…", activeNow: "Persona activa", none: "Ninguna persona activa — Mukta Zero usa su comportamiento por defecto.",
        custom: "Persona personalizada", remove: "Quitar", removing: "Quitando…", removeFail: "No pude quitar la persona.", activeBadge: "activa", readFail: "No se pudo leer la persona activa." },
};

export default function Persona({ supabase, onClose }) {
  const t = useT(STRINGS);
  const [tab, setTab] = useState("templates");
  const [busy, setBusy] = useState("");
  const [active, setActive] = useState("");     // slug da persona ATIVA (lido do banco, não presumido)
  const [loading, setLoading] = useState(true);
  const [desc, setDesc] = useState("");
  const [goals, setGoals] = useState(null);
  const [err, setErr] = useState("");

  // LEITURA (o que faltava): qual persona está ativa AGORA.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        // ESTE LEITOR NASCIA MUDO — e o defeito custou caro: eu destruturava só `data` e
        // engolia o erro, com o comentário "sem persona ativa é um estado válido, não um erro".
        // É verdade que não ter persona é estado válido; é falso que qualquer falha seja isso.
        // `mz_user_persona` está SEM grant para `authenticated` (403 42501, medido), então a
        // leitura SEMPRE falhava e a tela sempre dizia "Nenhuma persona ativa" — indistinguível
        // do estado real. Apliquei esta mesma lição na Observabilidade no mesmo dia e a violei
        // aqui. Agora o erro aparece, e "não sei" nunca mais se passa por "não há".
        const { data, error } = await supabase
          .from("mz_user_persona").select("persona_slug").eq("user_id", user.id).maybeSingle();
        if (!alive) return;
        if (error) {
          console.error("Persona: falha ao LER a persona ativa", error);
          setErr(`${t.readFail} ${error.message || ""}`.trim());
          return;
        }
        if (data?.persona_slug) setActive(data.persona_slug);
      } catch (e) {
        if (alive) { console.error("Persona: falha ao ler", e); setErr(`${t.readFail} ${e?.message || ""}`.trim()); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [supabase]);

  const labelOf = (slug) => (TEMPLATES.find((tp) => tp.slug === slug)?.label) || (slug === "custom_persona" ? t.custom : slug);

  async function pickTemplate(slug) {
    setErr(""); setBusy(slug);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("mz_user_persona").upsert({ user_id: user.id, persona_slug: slug });
      if (error) throw error;
      setActive(slug); setGoals(null);
    } catch (e) { setErr(String(e?.message || e)); } finally { setBusy(""); }
  }

  // ROLLBACK ao padrão — o "reversível" da Rota A precisa existir na superfície para ser real.
  async function removePersona() {
    setErr(""); setBusy("remove");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("mz_user_persona").delete().eq("user_id", user.id);
      if (error) throw error;
      setActive(""); setGoals(null);
    } catch (e) { setErr(`${t.removeFail} ${String(e?.message || e)}`); } finally { setBusy(""); }
  }

  async function compile() {
    setErr(""); if (!desc.trim()) return setErr(t.empty);
    setBusy("custom");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${config.SUPABASE_URL}/functions/v1/run-agent-chat`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}`, apikey: config.ANON_KEY },
        // client_name identifica a ORIGEM no run. Este era o último chamador síncrono meu sem
        // origem declarada: com o FB9 no ar, o `run-agent-chat` passou a gravar `mz_agent_runs`
        // para chamadas sem `job_id`, e sem esta linha o run apareceria com origem indefinida —
        // indistinguível de um turno de chat. O MZ-CLI-eng usa a mesma convenção (`mz-cli:build`).
        body: JSON.stringify({ action: "persona_compile", description: desc.trim(), slug: "custom_persona", client_name: "mz-web:persona" }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.detail || j.error || t.fail);
      setActive("custom_persona"); setGoals(j.pursue || []);
    } catch (e) { setErr(String(e?.message || e)); } finally { setBusy(""); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card/95 p-6 shadow-modal" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Fechar" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary"><X className="h-4 w-4" /></button>
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-teal-600 text-white shadow-sm"><UserCog className="h-6 w-6" /></div>
        <h2 className="mb-1 text-center text-xl font-bold text-foreground">{t.title}</h2>
        <p className="mb-4 text-center text-xs text-muted-foreground">{t.sub}</p>

        {/* ESTADO ATIVO — visível sempre, e é o que a versão anterior nunca mostrava. */}
        <div className="mb-4 rounded-lg border border-border bg-background/60 p-3" aria-live="polite">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t.loading}</p>
          ) : active ? (
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{t.activeNow}</p>
                <p className="truncate text-sm font-semibold text-foreground">{labelOf(active)}</p>
              </div>
              <button onClick={removePersona} disabled={!!busy}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:opacity-60">
                {busy === "remove" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {busy === "remove" ? t.removing : t.remove}
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t.none}</p>
          )}
          {goals && goals.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">{t.goals}</p>
              <ul className="space-y-1 text-sm text-foreground">
                {goals.map((g, i) => <li key={i} className="flex gap-1.5"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" />{g.metric}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div className="mb-4 flex gap-1 rounded-lg bg-secondary p-1">
          {[["templates", t.tab1], ["custom", t.tab2]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
        {err && <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}

        {tab === "templates" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TEMPLATES.map((tp) => {
              const isActive = active === tp.slug;
              return (
                <button key={tp.slug} onClick={() => pickTemplate(tp.slug)} disabled={!!busy} aria-pressed={isActive}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition disabled:opacity-60 ${isActive ? "border-teal-600 bg-teal-600/10 ring-1 ring-teal-600" : "border-border bg-background/60 hover:border-teal-600 hover:bg-teal-600/5"}`}>
                  <span className="flex w-full items-center gap-1.5 text-sm font-semibold text-foreground">
                    {busy === tp.slug ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : isActive ? <Check className="h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" /> : null}
                    <span className="min-w-0 flex-1">{tp.label}</span>
                    {isActive && <span className="shrink-0 rounded-full bg-teal-600 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">{t.activeBadge}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{tp.desc}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <textarea autoFocus rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} disabled={!!busy} placeholder={t.ph}
              className="w-full resize-none rounded-md border border-input bg-background p-3 text-sm placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <button onClick={compile} disabled={!!busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-60">
              {busy === "custom" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {busy === "custom" ? t.creating : t.create}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
