// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import { useState, useEffect, useRef } from "react";
import { Activity, Zap, AlertTriangle, Clock, Cpu, Square, RefreshCw, Loader2 } from "lucide-react";
import { useT } from "./lib/i18n.jsx";

const STRINGS = {
  pt: {
    title: "Control Tower",
    refresh: "Atualizar",
    activeNow: "Ativos agora",
    runs24h: "Runs 24h",
    tokens24h: "Tokens 24h",
    errorPct: "Erro %",
    runningNow: "Rodando agora",
    steps: "passos",
    uptime: "uptime",
    stopping: "Parando…",
    loading: "Carregando…",
    stop: "Parar",
    killPedido: "Parada solicitada. O run encerra no próximo checkpoint; o que já foi consumido continua cobrado.",
    killNada: "Nada a parar: este run já terminou, ou não é seu.",
    killErro: "Não foi possível enviar o pedido de parada.",
    noAgents: "Nenhum agente rodando agora.",
    consumptionByAgent: "Consumo por agente",
    colAgent: "Agente",
    colModel: "Modelo",
    colRuns: "Runs",
    colTokens: "Tokens",
    colLatency: "Latência",
    colCost: "Custo (pts)",
    noConsumption: "Sem consumo no período.",
  },
  en: {
    title: "Control Tower",
    refresh: "Refresh",
    activeNow: "Active now",
    runs24h: "Runs 24h",
    tokens24h: "Tokens 24h",
    errorPct: "Error %",
    runningNow: "Running now",
    steps: "steps",
    uptime: "uptime",
    stopping: "Stopping…",
    loading: "Loading…",
    stop: "Stop",
    killPedido: "Stop requested. The run ends at the next checkpoint; what was already consumed remains charged.",
    killNada: "Nothing to stop: this run already finished, or is not yours.",
    killErro: "Could not send the stop request.",
    noAgents: "No agents running right now.",
    consumptionByAgent: "Consumption by agent",
    colAgent: "Agent",
    colModel: "Model",
    colRuns: "Runs",
    colTokens: "Tokens",
    colLatency: "Latency",
    colCost: "Cost (pts)",
    noConsumption: "No consumption in this period.",
  },
  es: {
    title: "Torre de Control",
    refresh: "Actualizar",
    activeNow: "Activos ahora",
    runs24h: "Runs 24h",
    tokens24h: "Tokens 24h",
    errorPct: "Error %",
    runningNow: "Ejecutando ahora",
    steps: "pasos",
    uptime: "uptime",
    stopping: "Deteniendo…",
    loading: "Cargando…",
    stop: "Detener",
    killPedido: "Parada solicitada. El run termina en el próximo checkpoint; lo ya consumido sigue cobrado.",
    killNada: "Nada que detener: este run ya terminó, o no es tuyo.",
    killErro: "No se pudo enviar la solicitud de parada.",
    noAgents: "Ningún agente en ejecución ahora.",
    consumptionByAgent: "Consumo por agente",
    colAgent: "Agente",
    colModel: "Modelo",
    colRuns: "Runs",
    colTokens: "Tokens",
    colLatency: "Latencia",
    colCost: "Costo (pts)",
    noConsumption: "Sin consumo en el período.",
  },
};

function Uptime({ baseSec }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const total = (baseSec ?? 0) + tick;
  return <span className="tabular-nums">{Math.floor(total / 60) + "m " + (total % 60) + "s"}</span>;
}

export default function Torre({ supabase }) {
  const t = useT(STRINGS);
  const [health, setHealth] = useState(null);
  const [active, setActive] = useState([]);
  const [consumption, setConsumption] = useState([]);
  const [win, setWin] = useState("24h");
  const [loading, setLoading] = useState(true);
  const [killing, setKilling] = useState({});
  const [killMsg, setKillMsg] = useState(null); // veredito do "Parar" — UAT §3.2

  const reload = async () => {
    try {
      await supabase.rpc("mz_sweep_stale_runs");
      const { data: h } = await supabase.rpc("mz_ct_fleet_health");
      setHealth(Array.isArray(h) ? h[0] : (h || null));
      const { data: a } = await supabase.rpc("mz_ct_active_runs");
      setActive(a || []);
      const { data: c } = await supabase.rpc("mz_ct_consumption_by_agent", { p_window: win });
      setConsumption(c || []);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 5000);
    const onVis = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [win]);

  // UAT 2026-08-26 §3.2: este handler descartava o retorno e engolia o erro. Medido: o kill
  // devolvia `false` (não parou nada) e o usuário via só o spinner e um reload — o run seguia
  // sem uma palavra. Um controle que falha em silêncio é pior que um controle ausente: o
  // usuário aperta de novo, desiste, e abre chamado. Agora o veredito é lido e dito.
  const kill = async (missionId) => {
    setKilling((k) => ({ ...k, [missionId]: true }));
    setKillMsg(null);
    try {
      const { data, error } = await supabase.rpc("mz_request_kill", { p_mission_id: missionId });
      if (error) {
        setKillMsg({ tipo: "erro", texto: t.killErro || "Não foi possível enviar o pedido de parada." });
      } else if (data === true) {
        // Honestidade sobre o que o cancelamento faz: a chamada ao provedor já está em voo e
        // já foi cobrada — o que para é a espera e o registro, não o gasto.
        setKillMsg({ tipo: "ok", texto: t.killPedido || "Parada solicitada. O run encerra no próximo checkpoint; o que já foi consumido continua cobrado." });
      } else {
        setKillMsg({ tipo: "erro", texto: t.killNada || "Nada a parar: este run já terminou, ou não é seu." });
      }
    } catch {
      setKillMsg({ tipo: "erro", texto: t.killErro || "Não foi possível enviar o pedido de parada." });
    }
    setKilling((k) => ({ ...k, [missionId]: false }));
    setTimeout(reload, 1500);
  };

  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto p-4 text-foreground">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-foreground min-w-0 truncate">{t.title}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWin("24h")}
            className={`px-3 py-1 text-sm rounded-md font-medium transition-colors ${
              win === "24h"
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            24h
          </button>
          <button
            onClick={() => setWin("7d")}
            className={`px-3 py-1 text-sm rounded-md font-medium transition-colors ${
              win === "7d"
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            7d
          </button>
          <button
            onClick={reload}
            className="inline-flex items-center gap-1 px-3 py-1 text-sm rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {t.refresh}
          </button>
        </div>
      </div>

      {/* Cartões de saúde */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Activity className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wide">{t.activeNow}</span>
          </div>
          <div className="text-2xl font-semibold tabular-nums text-foreground">{health?.active_missions ?? 0}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Zap className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wide">{t.runs24h}</span>
          </div>
          <div className="text-2xl font-semibold tabular-nums text-foreground">{health?.runs_24h ?? 0}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Cpu className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wide">{t.tokens24h}</span>
          </div>
          <div className="text-2xl font-semibold tabular-nums text-foreground">{health?.tokens_24h ?? 0}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wide">{t.errorPct}</span>
          </div>
          <div className="text-2xl font-semibold tabular-nums text-foreground">{(health?.error_rate ?? 0)}%</div>
        </div>
      </div>

      {/* Rodando agora */}
      <div>
        <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-3">{t.runningNow}</h2>

        {/* Veredito do "Parar" — UAT §3.2. role=status faz o leitor de tela anunciar sem roubar o foco. */}
        {killMsg && (
          <div
            role="status"
            aria-live="polite"
            className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
              killMsg.tipo === "ok"
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-destructive/40 bg-destructive/10 text-foreground"
            }`}
          >
            {killMsg.texto}
          </div>
        )}
        {loading ? (
          <div role="status" className="flex justify-center py-6">
            <Loader2 aria-hidden="true" className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="sr-only">{t.loading}</span>
          </div>
        ) : active.length > 0 ? (
          <div className="flex flex-col gap-2">
            {active.map((m) => (
              <div
                key={m.mission_id}
                className="rounded-xl border border-border bg-card p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium line-clamp-2">{m.goal}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {m.status} • {m.steps_done}/{m.steps_total} {t.steps} • {t.uptime} <Uptime baseSec={m.uptime_s} />
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => kill(m.mission_id)}
                  disabled={!!killing[m.mission_id]}
                  className="bg-red-600 text-white rounded-md px-3 py-1.5 text-sm hover:bg-red-700 inline-flex items-center gap-1 disabled:opacity-60 shrink-0 ml-3"
                >
                  <Square className="w-3.5 h-3.5" />
                  {killing[m.mission_id] ? t.stopping : t.stop}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-4 text-muted-foreground">{t.noAgents}</p>
        )}
      </div>

      {/* Consumo por agente */}
      <div>
        <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-3">{t.consumptionByAgent}</h2>
        {consumption.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[560px] text-sm">
              <div className="grid grid-cols-6 gap-2 py-2 border-b border-border font-medium text-muted-foreground">
                <div>{t.colAgent}</div>
                <div>{t.colModel}</div>
                <div className="text-right">{t.colRuns}</div>
                <div className="text-right">{t.colTokens}</div>
                <div className="text-right">{t.colLatency}</div>
                <div className="text-right">{t.colCost}</div>
              </div>
              {consumption.map((c, i) => (
                <div
                  key={i}
                  className="grid grid-cols-6 gap-2 py-2 border-b border-border/60 text-foreground"
                >
                  <div className="truncate">{c.agent}</div>
                  <div className="truncate">{c.model_slug}</div>
                  <div className="text-right tabular-nums">{c.runs}</div>
                  <div className="text-right tabular-nums">{c.tokens}</div>
                  <div className="text-right tabular-nums">{(c.avg_latency_ms ?? "?")}ms</div>
                  <div className="text-right tabular-nums">{c.cost_points != null ? c.cost_points : "—"}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="py-4 text-muted-foreground">{t.noConsumption}</p>
        )}
      </div>
    </div>
  );
}
