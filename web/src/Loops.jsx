// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import React, { useState, useEffect, useCallback } from "react";
import {
  Repeat, Target, Loader2, RefreshCw, AlertTriangle, Plus, Square, Check, Copy, X,
  Webhook, Trash2, Coins, Clock, Layers,
} from "lucide-react";
import { useT } from "./lib/i18n.jsx";

// LAÇOS (loop · goal) e WAKEUP POR WEBHOOK.
//
// Contrato provado na .107: gate mz-web/scripts/verify-loops-hooks-api.cjs 24/24 + o webhook ponta
// a ponta 5/5 (dispara sem sessão, executa, cobra a carteira do DONO).
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// TRÊS COISAS QUE ESTA TELA É OBRIGADA A MOSTRAR
//
// 1) O MOTIVO DA PARADA, sempre. O esquema tem CONSTRAINT: laço parado sem motivo não existe. Um
//    laço que "terminou" sem dizer por quê é o mesmo defeito da aba de Falhas antes de 08/08 —
//    ausência que se lê como sucesso. Aqui o motivo é a informação principal da linha, não um
//    detalhe escondido.
//
// 2) O TETO E O GASTO JUNTOS. Pontos gastos sozinhos não dizem se falta muito; teto sozinho não diz
//    onde está. O par é o que permite decidir se para agora. E o billing está LIGADO desde 08/08,
//    então isto é dinheiro, não métrica.
//
// 3) QUE A TAREFA DO WEBHOOK VIVE NO HOOK. Quem recebe a chave costuma supor que pode mandar o
//    prompt — é o que qualquer webhook faz. Aqui não, de propósito: chave vazada não vira LLM
//    ilimitado na carteira de quem a criou. Se a tela não disser isso, o usuário descobre por um
//    400 e conclui que está quebrado.
// ─────────────────────────────────────────────────────────────────────────────────────────

const STRINGS = {
  pt: {
    title: "Laços e Webhooks", sub: "Execução repetida com condição de parada, e pontos de wakeup por chave.",
    tabLoops: "Laços", tabHooks: "Webhooks",
    refresh: "Atualizar", loading: "Carregando…", err: "Erro",
    loadFail: "Não foi possível carregar os laços.",
    none: "Nenhum laço ainda.", noHooks: "Nenhum webhook criado.",

    create: "Novo laço", goal: "Objetivo", kind: "Tipo",
    kindLoop: "loop — repete a cada intervalo", kindGoal: "goal — verifica a cada turno",
    interval: "Intervalo (segundos)", maxIter: "Teto de iterações", maxPts: "Teto de pontos",
    stopWhen: "Parar quando", stTimes: "atingir N iterações", stDeadline: "chegar a data/hora",
    stBudget: "gastar N pontos", stNoChange: "N voltas sem novidade",
    stopHint: "Ao menos uma condição é obrigatória — o backend recusa laço sem freio.",
    createDo: "Criar laço", cancel: "Cancelar",

    running: "em curso", stopped: "parado", stop: "Parar",
    iterOf: (a, b) => `iteração ${a} de ${b}`,
    ptsOf: (a, b) => `${Number(a).toFixed(3).replace(/\.?0+$/, "")} de ${b} pts`,
    next: "próximo disparo", never: "—", reason: "Motivo da parada",
    lastIter: "Última iteração", byTurn: "verifica a cada turno (sem relógio)",

    hookSub: "Uma chamada HTTP com chave acorda o agente e executa a TAREFA GRAVADA NO HOOK.",
    hookTaskRule: "A tarefa vive no hook, não na chamada: quem dispara NÃO envia prompt. É o que impede que uma chave vazada vire uso ilimitado na sua carteira.",
    hookNew: "Novo webhook", hookLabel: "Rótulo", hookTask: "Tarefa que o agente executa",
    hookVars: "Variáveis que o chamador pode preencher (uma por linha, use {{nome}} na tarefa)",
    hookPts: "Teto de pontos por chamada", hookRate: "Teto de chamadas por hora",
    hookCreate: "Gerar webhook",
    hookOnce: "Copie agora: o segredo não é armazenado e não volta a ser exibido.",
    copy: "Copiar", copied: "Copiado", revoke: "Revogar", revoked: "revogada",
    usedNever: "nunca usada", usedAt: "último uso", callsHour: (a, b) => `${a}/${b} nesta hora`,
    howTo: "Como chamar",
  },
  en: {
    title: "Loops and Webhooks", sub: "Repeated execution with a stopping condition, and keyed wakeup points.",
    tabLoops: "Loops", tabHooks: "Webhooks",
    refresh: "Refresh", loading: "Loading…", err: "Error",
    loadFail: "Could not load loops.", none: "No loops yet.", noHooks: "No webhooks created.",
    create: "New loop", goal: "Goal", kind: "Type",
    kindLoop: "loop — repeats every interval", kindGoal: "goal — checks every turn",
    interval: "Interval (seconds)", maxIter: "Iteration ceiling", maxPts: "Points ceiling",
    stopWhen: "Stop when", stTimes: "N iterations reached", stDeadline: "a date/time is reached",
    stBudget: "N points spent", stNoChange: "N rounds with no change",
    stopHint: "At least one condition is required — the backend refuses a loop with no brake.",
    createDo: "Create loop", cancel: "Cancel",
    running: "running", stopped: "stopped", stop: "Stop",
    iterOf: (a, b) => `iteration ${a} of ${b}`,
    ptsOf: (a, b) => `${Number(a).toFixed(3).replace(/\.?0+$/, "")} of ${b} pts`,
    next: "next fire", never: "—", reason: "Stop reason",
    lastIter: "Last iteration", byTurn: "checks every turn (no clock)",
    hookSub: "An HTTP call with a key wakes the agent and runs the TASK STORED IN THE HOOK.",
    hookTaskRule: "The task lives in the hook, not in the call: the caller does NOT send a prompt. That is what stops a leaked key from becoming unlimited usage on your wallet.",
    hookNew: "New webhook", hookLabel: "Label", hookTask: "Task the agent runs",
    hookVars: "Variables the caller may fill (one per line, use {{name}} in the task)",
    hookPts: "Points ceiling per call", hookRate: "Calls per hour ceiling",
    hookCreate: "Generate webhook",
    hookOnce: "Copy it now: the secret is not stored and will not be shown again.",
    copy: "Copy", copied: "Copied", revoke: "Revoke", revoked: "revoked",
    usedNever: "never used", usedAt: "last used", callsHour: (a, b) => `${a}/${b} this hour`,
    howTo: "How to call",
  },
};
STRINGS.es = STRINGS.pt;

const Card = ({ children, className = "" }) => (
  <div className={`rounded-xl border border-border bg-surface ${className}`}>{children}</div>
);
const Tab = ({ id, tab, setTab, label, Icon }) => (
  <button onClick={() => setTab(id)} role="tab" aria-selected={tab === id}
    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      tab === id ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"}`}>
    <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
  </button>
);

export default function Loops({ supabase, lang = "pt", initialTab = "loops" }) {
  const t = useT(STRINGS, lang);
  const [tab, setTab] = useState(initialTab);
  const [loops, setLoops] = useState(null);
  const [hooks, setHooks] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    const [l, h] = await Promise.all([supabase.rpc("mz_my_loops", { p_limit: 50 }), supabase.rpc("mz_hooks")]);
    // Leitor nunca mudo: erro de carga não pode parecer "não há laços".
    if (l.error) { console.error("mz_my_loops:", l.error); setErr(`${t.loadFail} ${l.error.message || ""}`.trim()); }
    setLoops(l.error ? [] : (l.data || []));
    if (h.error) console.error("mz_hooks:", h.error);
    setHooks(h.error ? [] : (h.data || []));
  }, [supabase, t.loadFail]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-foreground">{t.title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t.sub}</p>
        </div>
        <button onClick={load}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2">
          <RefreshCw className="h-4 w-4" />{t.refresh}
        </button>
      </header>

      {err ? (
        <Card className="mb-4 border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{err}
          </p>
        </Card>
      ) : null}

      <div className="mb-4 flex items-center gap-1 border-b border-border pb-2" role="tablist">
        <Tab id="loops" tab={tab} setTab={setTab} label={t.tabLoops} Icon={Repeat} />
        <Tab id="hooks" tab={tab} setTab={setTab} label={t.tabHooks} Icon={Webhook} />
      </div>

      {tab === "loops"
        ? <LoopsTab {...{ supabase, t, loops, load, setErr, busy, setBusy }} />
        : <HooksTab {...{ supabase, t, hooks, load, setErr }} />}
    </div>
  );
}

// ── Laços ────────────────────────────────────────────────────────────────────────────────
function LoopsTab({ supabase, t, loops, load, setErr, busy, setBusy }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ goal: "", kind: "loop", interval_s: 300, max_iterations: 10, max_points: 10 });
  const [cond, setCond] = useState({ times: 5, deadline: "", budget: "", no_change: "" });

  const criar = async () => {
    setBusy(true); setErr("");
    // Condições montadas a partir do que o usuário preencheu. Vazio = não declarada, e o backend
    // recusa a lista vazia — o que é certo: laço sem freio não deve ser criável por esquecimento.
    const cs = [];
    if (Number(cond.times) > 0) cs.push({ kind: "times", n: Number(cond.times) });
    if (cond.deadline) cs.push({ kind: "deadline", at: new Date(cond.deadline).toISOString() });
    if (Number(cond.budget) > 0) cs.push({ kind: "budget", points: Number(cond.budget) });
    if (Number(cond.no_change) > 0) cs.push({ kind: "no_change", rounds: Number(cond.no_change) });
    const { error } = await supabase.rpc("mz_loop_create", {
      p_goal: f.goal, p_kind: f.kind,
      p_interval_s: f.kind === "goal" ? null : Number(f.interval_s),
      p_stop_conditions: cs, p_max_iterations: Number(f.max_iterations), p_max_points: Number(f.max_points),
    });
    setBusy(false);
    if (error) { console.error("mz_loop_create:", error); setErr(`${t.err}: ${error.message}`); return; }
    setOpen(false); setF({ ...f, goal: "" }); load();
  };

  const parar = async (id) => {
    const { error } = await supabase.rpc("mz_loop_stop", { p_id: id, p_reason: "parado na tela" });
    if (error) { console.error("mz_loop_stop:", error); setErr(`${t.err}: ${error.message}`); return; }
    load();
  };

  const Num = ({ label, v, on, min = 0 }) => (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">{label}
      <input type="number" min={min} value={v} onChange={(e) => on(e.target.value)}
        className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm tabular-nums text-foreground" />
    </label>
  );

  return (
    <div className="grid gap-4">
      {open ? (
        <Card className="grid gap-3 p-4">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">{t.goal}
            <textarea rows={2} value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">{t.kind}
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}
                className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground">
                <option value="loop">{t.kindLoop}</option>
                <option value="goal">{t.kindGoal}</option>
              </select>
            </label>
            {/* 'goal' não tem intervalo: o campo desaparece em vez de ficar cinzento a sugerir que
                existe e é ignorado. O backend grava NULL para goal. */}
            {f.kind === "loop"
              ? <Num label={t.interval} v={f.interval_s} on={(v) => setF({ ...f, interval_s: v })} min={60} />
              : <p className="self-end text-[11px] italic text-muted-foreground">{t.byTurn}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Num label={t.maxIter} v={f.max_iterations} on={(v) => setF({ ...f, max_iterations: v })} min={1} />
            <Num label={t.maxPts} v={f.max_points} on={(v) => setF({ ...f, max_points: v })} min={1} />
          </div>

          <div className="rounded-lg border border-border bg-surface-2/50 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{t.stopWhen}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Num label={t.stTimes} v={cond.times} on={(v) => setCond({ ...cond, times: v })} />
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">{t.stDeadline}
                <input type="datetime-local" value={cond.deadline} onChange={(e) => setCond({ ...cond, deadline: e.target.value })}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground" />
              </label>
              <Num label={t.stBudget} v={cond.budget} on={(v) => setCond({ ...cond, budget: v })} />
              <Num label={t.stNoChange} v={cond.no_change} on={(v) => setCond({ ...cond, no_change: v })} />
            </div>
            <p className="mt-2 text-[11px] italic text-muted-foreground">{t.stopHint}</p>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={criar} disabled={busy || f.goal.trim().length < 3}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t.createDo}
            </button>
            <button onClick={() => setOpen(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-2">{t.cancel}</button>
          </div>
        </Card>
      ) : (
        <button onClick={() => setOpen(true)}
          className="inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2">
          <Plus className="h-4 w-4" />{t.create}
        </button>
      )}

      {loops === null ? <div className="h-20 animate-pulse rounded-xl bg-surface-2/60" />
        : loops.length === 0 ? <Card className="p-5"><p className="text-sm text-muted-foreground">{t.none}</p></Card> : (
        <div className="grid gap-2">
          {loops.map((l) => {
            const rodando = l.status === "running";
            const pct = Math.min(100, (Number(l.points_spent) / Number(l.max_points)) * 100);
            return (
              <Card key={l.id} className={`p-3.5 ${rodando ? "" : "opacity-70"}`}>
                <div className="flex items-start gap-2.5">
                  {l.kind === "goal" ? <Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                     : <Repeat className={`mt-0.5 h-4 w-4 shrink-0 ${rodando ? "text-primary" : "text-muted-foreground"}`} />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{l.goal}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                      <span className={rodando ? "text-primary" : ""}>{rodando ? t.running : t.stopped}</span>
                      <span className="tabular-nums">{t.iterOf(l.iteration, l.max_iterations)}</span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Coins className="h-3 w-3" />{t.ptsOf(l.points_spent, l.max_points)}
                      </span>
                      {rodando && l.kind === "loop" && l.next_fire_at ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />{t.next} {new Date(l.next_fire_at).toLocaleTimeString()}
                        </span>
                      ) : null}
                      {l.kind === "goal" ? <span className="italic">{t.byTurn}</span> : null}
                    </p>
                    {/* TETO E GASTO JUNTOS: a barra é o par, e é o que permite decidir parar agora. */}
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                      <div className={`h-full ${pct > 80 ? "bg-warning" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                    </div>
                    {/* O MOTIVO é informação principal, não detalhe escondido. */}
                    {!rodando && l.stopped_reason ? (
                      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning">
                        <Square className="mt-0.5 h-3 w-3 shrink-0" />
                        <span><span className="font-medium">{t.reason}:</span> {l.stopped_reason}</span>
                      </p>
                    ) : null}
                    {l.ultima_iteracao ? (
                      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Layers className="h-3 w-3" />{t.lastIter} #{l.ultima_iteracao.iteration}
                        {l.ultima_iteracao.status ? ` · ${l.ultima_iteracao.status}` : ""}
                        {l.ultima_iteracao.error_code ? ` · ${l.ultima_iteracao.error_code}` : ""}
                      </p>
                    ) : null}
                  </div>
                  {rodando ? (
                    <button onClick={() => parar(l.id)} title={t.stop}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-2 hover:text-destructive">
                      <Square className="h-3 w-3" />{t.stop}
                    </button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Webhooks ─────────────────────────────────────────────────────────────────────────────
function HooksTab({ supabase, t, hooks, load, setErr }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ label: "", task: "", vars: "", pts: 2, rate: 12 });
  const [fresh, setFresh] = useState(null);
  const [copied, setCopied] = useState("");

  const criar = async () => {
    setErr("");
    const vars = f.vars.split("\n").map((x) => x.trim()).filter(Boolean);
    const { data, error } = await supabase.rpc("mz_hook_create", {
      p_label: f.label, p_task: f.task,
      p_max_points_per_call: Number(f.pts), p_max_calls_per_hour: Number(f.rate),
      p_declared_vars: vars.length ? vars : null,
    });
    if (error) { console.error("mz_hook_create:", error); setErr(`${t.err}: ${error.message}`); return; }
    setFresh((data || [])[0] || null); setOpen(false); setF({ ...f, label: "", task: "", vars: "" }); load();
  };
  const revogar = async (id) => {
    const { error } = await supabase.rpc("mz_hook_revoke", { p_id: id });
    if (error) { console.error("mz_hook_revoke:", error); setErr(`${t.err}: ${error.message}`); return; }
    load();
  };

  const curl = (secret) =>
    `curl -X POST https://api.example.com/functions/v1/mz-hook \\\n  -H "x-mz-hook-key: ${secret}" \\\n  -H "content-type: application/json" -d '{}'`;

  return (
    <div className="grid gap-4">
      <Card className="p-3">
        <p className="text-xs text-muted-foreground">{t.hookSub}</p>
        {/* Sem isto o usuário tenta mandar prompt, recebe 400 e conclui que está quebrado. */}
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t.hookTaskRule}
        </p>
      </Card>

      {fresh ? (
        <Card className="border-primary/40 bg-primary-soft p-3.5">
          <p className="text-xs font-medium text-primary">{t.hookOnce}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-surface px-2.5 py-1.5 font-mono text-xs text-foreground">{fresh.secret}</code>
            <button onClick={() => { navigator.clipboard?.writeText(fresh.secret); setCopied("k"); }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2">
              {copied === "k" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === "k" ? t.copied : t.copy}
            </button>
            <button onClick={() => { setFresh(null); setCopied(""); }} aria-label="fechar"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface"><X className="h-3.5 w-3.5" /></button>
          </div>
          <p className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary/80">{t.howTo}</p>
          <pre className="overflow-x-auto rounded-lg bg-surface px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">{curl(fresh.secret)}</pre>
        </Card>
      ) : null}

      {open ? (
        <Card className="grid gap-3 p-4">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">{t.hookLabel}
            <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">{t.hookTask}
            <textarea rows={3} value={f.task} onChange={(e) => setF({ ...f, task: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">{t.hookVars}
            <textarea rows={2} value={f.vars} onChange={(e) => setF({ ...f, vars: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-foreground" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">{t.hookPts}
              <input type="number" min={1} value={f.pts} onChange={(e) => setF({ ...f, pts: e.target.value })}
                className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm tabular-nums text-foreground" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">{t.hookRate}
              <input type="number" min={1} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })}
                className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm tabular-nums text-foreground" />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={criar} disabled={!f.label.trim() || f.task.trim().length < 3}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              <Webhook className="h-4 w-4" />{t.hookCreate}
            </button>
            <button onClick={() => setOpen(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-2">{t.cancel}</button>
          </div>
        </Card>
      ) : (
        <button onClick={() => setOpen(true)}
          className="inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2">
          <Plus className="h-4 w-4" />{t.hookNew}
        </button>
      )}

      {hooks === null ? <div className="h-16 animate-pulse rounded-xl bg-surface-2/60" />
        : hooks.length === 0 ? <Card className="p-5"><p className="text-sm text-muted-foreground">{t.noHooks}</p></Card> : (
        <Card>
          {hooks.map((h, i) => (
            <div key={h.id} className={`flex items-start gap-3 px-3.5 py-2.5 ${i ? "border-t border-border" : ""} ${h.revoked_at ? "opacity-55" : ""}`}>
              <Webhook className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{h.label}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{h.key_prefix}…</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{h.task}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{t.callsHour(h.calls_this_hour, h.max_calls_per_hour)}</span>
                  <span className="inline-flex items-center gap-1 tabular-nums"><Coins className="h-3 w-3" />≤ {h.max_points_per_call}</span>
                  <span>{h.revoked_at ? t.revoked : h.last_used_at ? `${t.usedAt} ${new Date(h.last_used_at).toLocaleString()}` : t.usedNever}</span>
                </p>
              </div>
              {!h.revoked_at ? (
                <button onClick={() => revogar(h.id)} title={t.revoke} aria-label={t.revoke}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
