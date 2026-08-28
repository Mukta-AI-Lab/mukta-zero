// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle, XCircle, Cpu, Clock, Zap, FileCode, Loader2, X, ShieldCheck } from "lucide-react";
import Times from "./Times.jsx";
import Fases from "./Fases.jsx";
import Trocas from "./Trocas.jsx";
import { useT } from "./lib/i18n.jsx";

const STRINGS = {
  pt: {
    title: "Plano de trabalho",
    subtitle: "O passo a passo de cada missão dos agentes, com o trace de execução.",
    tabThread: "Thread",
    tabTimes: "Times",
    tabFases: "Fases",
    tabTrocas: "Trocas",
    threadsHeading: "Threads",
    noThreads: "Nenhuma thread ainda.",
    steps: "passos",
    selectThread: "Selecione uma thread para ver o plano.",
    auditing: "Auditando...",
    audit: "Auditar",
    noSteps: "Sem passos registrados.",
    stepFallback: "passo",
    view: "ver",
    roleLabel: "role:",
    phaseLabel: "fase:",
    deliverable: "Deliverable",
    deliverableTitle: "deliverable",
    auditModalTitle: "Auditoria da missão",
    verdictLabel: "Veredito",
    noReport: "Sem relatório.",
    auditFailed: "Falha ao auditar: ",
    errorGeneric: "erro",
  },
  en: {
    title: "Work plan",
    subtitle: "The step-by-step of each agent mission, with the execution trace.",
    tabThread: "Thread",
    tabTimes: "Teams",
    tabFases: "Phases",
    tabTrocas: "Swaps",
    threadsHeading: "Threads",
    noThreads: "No threads yet.",
    steps: "steps",
    selectThread: "Select a thread to see the plan.",
    auditing: "Auditing...",
    audit: "Audit",
    noSteps: "No steps recorded.",
    stepFallback: "step",
    view: "view",
    roleLabel: "role:",
    phaseLabel: "phase:",
    deliverable: "Deliverable",
    deliverableTitle: "deliverable",
    auditModalTitle: "Mission audit",
    verdictLabel: "Verdict",
    noReport: "No report.",
    auditFailed: "Audit failed: ",
    errorGeneric: "error",
  },
  es: {
    title: "Plan de trabajo",
    subtitle: "El paso a paso de cada misión de los agentes, con el trace de ejecución.",
    tabThread: "Hilo",
    tabTimes: "Equipos",
    tabFases: "Fases",
    tabTrocas: "Cambios",
    threadsHeading: "Hilos",
    noThreads: "Aún no hay hilos.",
    steps: "pasos",
    selectThread: "Selecciona un hilo para ver el plan.",
    auditing: "Auditando...",
    audit: "Auditar",
    noSteps: "Sin pasos registrados.",
    stepFallback: "paso",
    view: "ver",
    roleLabel: "rol:",
    phaseLabel: "fase:",
    deliverable: "Entregable",
    deliverableTitle: "entregable",
    auditModalTitle: "Auditoría de la misión",
    verdictLabel: "Veredicto",
    noReport: "Sin informe.",
    auditFailed: "Fallo al auditar: ",
    errorGeneric: "error",
  },
};

export default function Plano({ supabase, onAudit }) {
  const [missions, setMissions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [steps, setSteps] = useState([]);
  const [runsByStep, setRunsByStep] = useState({});
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sub, setSub] = useState("thread");
  const [auditing, setAuditing] = useState(false);
  const [audit, setAudit] = useState(null);
  const t = useT(STRINGS);

  async function loadMissions() {
    try {
      const { data } = await supabase
        .from("mz_missions")
        .select("id,goal,status,steps_total,steps_done,created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      setMissions(data || []);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMissions();
  }, []);

  async function openMission(m) {
    setSelected(m);
    setPreview(null);
    setLoadingDetail(true);
    try {
      const { data: st } = await supabase
        .from("mz_mission_steps")
        .select("id,idx,title,status,artifact_id,role,phase_id")
        .eq("mission_id", m.id)
        .order("idx", { ascending: true });
      setSteps(st || []);

      const { data: rn } = await supabase
        .from("mz_agent_runs")
        .select("step_id,model_slug,latency_ms,tokens_used,status")
        .eq("mission_id", m.id);
      const map = {};
      (rn || []).forEach((r) => {
        if (r.step_id) map[r.step_id] = r;
      });
      setRunsByStep(map);
    } catch {
      // silencioso
    } finally {
      setLoadingDetail(false);
    }
  }

  async function openArtifact(id) {
    if (!id) return;
    try {
      const { data } = await supabase
        .from("mz_artifacts")
        .select("content")
        .eq("id", id)
        .single();
      if (data) setPreview(data.content);
    } catch {
      // silencioso
    }
  }

  async function doAudit() {
    if (!selected || !onAudit) return;
    setAuditing(true);
    setAudit(null);
    try {
      const r = await onAudit(selected.id);
      setAudit(r);
    } catch (e) {
      setAudit({ error: true, report: t.auditFailed + (e?.message || t.errorGeneric) });
    } finally {
      setAuditing(false);
    }
  }

  function statusIcon(s) {
    switch (s) {
      case "done":
        return <CheckCircle2 className="w-4 h-4 text-teal-600" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-red-500" />;
      case "running":
        return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
      default:
        return <AlertCircle className="w-4 h-4 text-amber-500" />;
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto p-4 text-foreground">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{t.title}</h1>
        <p className="text-sm text-muted-foreground">
          {t.subtitle}
        </p>
      </div>

      {/* Sub-abas 8d — lentes sobre o mesmo trabalho */}
      <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1 self-start">
        {[["thread", t.tabThread], ["times", t.tabTimes], ["fases", t.tabFases], ["trocas", t.tabTrocas]].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSub(k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${sub === k ? "bg-card text-teal-700 shadow-sm dark:text-teal-300" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {sub === "times" && <Times supabase={supabase} />}
      {sub === "fases" && <Fases supabase={supabase} />}
      {sub === "trocas" && <Trocas supabase={supabase} />}

      {/* Grid — Thread */}
      {sub === "thread" && (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Coluna esquerda — lista de missões */}
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">{t.threadsHeading}</h2>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : missions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noThreads}</p>
          ) : (
            missions.map((m) => (
              <button
                key={m.id}
                onClick={() => openMission(m)}
                className={`w-full flex flex-col gap-0.5 text-left rounded-xl border p-3 transition-colors ${
                  selected?.id === m.id
                    ? "border-teal-300 bg-teal-50 dark:border-teal-500/30 dark:bg-teal-500/10"
                    : "border-border bg-card hover:border-slate-300"
                }`}
              >
                <div className="font-medium text-sm line-clamp-2">{m.goal}</div>
                <div className="text-xs text-muted-foreground">
                  {m.status} &bull; {m.steps_done ?? 0}/{m.steps_total ?? 0} {t.steps}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Coluna direita — detalhe */}
        <div className="md:col-span-2">
          {!selected ? (
            <div className="flex items-center justify-center h-full min-h-[200px] text-muted-foreground text-sm">
              {t.selectThread}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-foreground flex-1 min-w-0 truncate">{selected.goal}</h3>
                {onAudit && (
                  <button
                    onClick={doAudit}
                    disabled={auditing}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-teal-300 hover:text-teal-700 disabled:opacity-60"
                  >
                    {auditing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                    {auditing ? t.auditing : t.audit}
                  </button>
                )}
              </div>

              {loadingDetail ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : steps.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.noSteps}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {steps.map((step) => {
                    const run = runsByStep[step.id];
                    return (
                      <div
                        key={step.id}
                        className="rounded-xl border border-border bg-card p-3 flex flex-col gap-1"
                      >
                        {/* Linha 1 */}
                        <div className="flex min-w-0 items-center gap-2">
                          {statusIcon(step.status)}
                          <span className="font-medium text-sm truncate">
                            #{step.idx} {step.title || t.stepFallback}
                          </span>
                          {step.artifact_id && (
                            <button
                              onClick={() => openArtifact(step.artifact_id)}
                              className="ml-auto text-teal-600 text-xs inline-flex items-center gap-1 hover:text-teal-700 transition-colors"
                            >
                              <FileCode className="w-3.5 h-3.5" />
                              {t.view}
                            </button>
                          )}
                        </div>

                        {/* Linha 2 — badges */}
                        <div className="flex flex-wrap gap-1">
                          {step.role && (
                            <span className="rounded bg-muted text-muted-foreground text-xs px-1.5 py-0.5">
                              {t.roleLabel} {step.role}
                            </span>
                          )}
                          {step.phase_id && (
                            <span className="rounded bg-muted text-muted-foreground text-xs px-1.5 py-0.5">
                              {t.phaseLabel} {step.phase_id}
                            </span>
                          )}
                        </div>

                        {/* Linha 3 — trace */}
                        {run && (
                          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground mt-0.5">
                            <span className="inline-flex items-center gap-1">
                              <Cpu className="w-3 h-3" />
                              {run.model_slug}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {run.latency_ms ?? "?"}ms
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Zap className="w-3 h-3" />
                              {run.tokens_used ?? 0} tok
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Modal preview */}
      {preview !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-xl w-full max-w-4xl h-[80vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="font-semibold text-sm text-foreground">{t.deliverable}</span>
              <button
                onClick={() => setPreview(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <iframe
              title={t.deliverableTitle}
              srcDoc={preview}
              className="flex-1 w-full rounded-b-xl"
              sandbox="allow-scripts"
            />
          </div>
        </div>
      )}

      {/* Modal auditoria 8g */}
      {audit !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="font-semibold text-sm text-foreground inline-flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-teal-600" />
                {t.auditModalTitle}
              </span>
              <button onClick={() => setAudit(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex flex-col gap-3">
              {audit.verdict && (
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase text-muted-foreground">{t.verdictLabel}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      audit.verdict === "ok"
                        ? "bg-teal-50 text-teal-700 border border-teal-200"
                        : audit.verdict === "falha"
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : "bg-amber-50 text-amber-700 border border-amber-200"
                    }`}
                  >
                    {audit.verdict}
                  </span>
                </div>
              )}
              {Array.isArray(audit.anomalies) && audit.anomalies.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {audit.anomalies.map((a, i) => (
                    <li key={i} className="text-xs text-amber-700 flex items-start gap-1">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      {a}
                    </li>
                  ))}
                </ul>
              )}
              <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {audit.report || t.noReport}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
