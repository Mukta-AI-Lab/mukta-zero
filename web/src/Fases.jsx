// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, XCircle, Zap } from "lucide-react";
import { useT } from "./lib/i18n.jsx";

const STRINGS = {
  pt: {
    title: "Fases do workflow",
    subtitle: "Progresso agregado por fase de execução.",
    empty: "Sem fases.",
    ok: "ok",
    failures: "falhas",
    tokens: "tok",
    noActivity: "sem atividade",
  },
  en: {
    title: "Workflow phases",
    subtitle: "Aggregated progress by execution phase.",
    empty: "No phases.",
    ok: "ok",
    failures: "failures",
    tokens: "tok",
    noActivity: "no activity",
  },
  es: {
    title: "Fases del flujo de trabajo",
    subtitle: "Progreso agregado por fase de ejecución.",
    empty: "Sin fases.",
    ok: "ok",
    failures: "fallos",
    tokens: "tok",
    noActivity: "sin actividad",
  },
};

export default function Fases({ supabase }) {
  const t = useT(STRINGS);
  const [phases, setPhases] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const { data } = await supabase.rpc("mz_get_my_phase_progress");
      setPhases(data || []);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function pct(p) {
    if (!p.total || p.total <= 0) return 0;
    return Math.round((100 * (p.done || 0)) / p.total);
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto p-4 text-slate-800">
      <div>
        <h1 className="text-xl font-bold">{t.title}</h1>
        <p className="text-sm text-slate-500">
          {t.subtitle}
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : phases.length === 0 ? (
        <p className="text-sm text-slate-400">{t.empty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {phases.map((p) => (
            <div
              key={p.slug}
              className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-2"
            >
              {/* cabeçalho */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="grid place-items-center w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[10px]">
                    {p.ord}
                  </span>
                  <span className="font-medium">{p.name}</span>
                </div>
                <span className="text-xs text-slate-500">
                  {p.done || 0}/{p.total || 0}
                </span>
              </div>

              {/* barra */}
              <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-teal-500 rounded-full transition-all"
                  style={{ width: pct(p) + "%" }}
                />
              </div>

              {/* contadores */}
              <div className="flex flex-wrap gap-x-3 text-xs">
                <span className="inline-flex items-center gap-1 text-teal-600">
                  <CheckCircle2 className="w-3 h-3" />
                  {p.done || 0} {t.ok}
                </span>
                {p.failed > 0 && (
                  <span className="inline-flex items-center gap-1 text-red-500">
                    <XCircle className="w-3 h-3" />
                    {p.failed} {t.failures}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-slate-400">
                  <Zap className="w-3 h-3" />
                  {p.tokens || 0} {t.tokens}
                </span>
                {!p.total && (
                  <span className="text-slate-400">{t.noActivity}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
