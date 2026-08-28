// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import { useState, useEffect } from "react";
import { Wand2, Loader2, Download, ExternalLink, FileCode, AlertCircle } from "lucide-react";
import { useT } from "./lib/i18n.jsx";

const STRINGS = {
  pt: {
    title: "Studio",
    subtitle: "Gere sites a partir de uma descrição.",
    specPlaceholder: "Descreva o site: ex. landing page para uma cafeteria moderna...",
    generateBtn: "Gerar site",
    previewPrefix: "Prévia:",
    previewTitle: "preview",
    download: "Download",
    open: "Abrir",
    artifacts: "Artefatos",
    empty: "Nenhum site gerado ainda.",
    generateFail: "Não foi possível gerar o site. Tente novamente.",
    generatingLong: "gerando site… (pode levar 1-2 min)",
    elapsedLabel: "decorrido",
    loadingLabel: "Carregando…",
  },
  en: {
    title: "Studio",
    subtitle: "Generate sites from a description.",
    specPlaceholder: "Describe the site: e.g. landing page for a modern coffee shop...",
    generateBtn: "Generate site",
    previewPrefix: "Preview:",
    previewTitle: "preview",
    download: "Download",
    open: "Open",
    artifacts: "Artifacts",
    empty: "No site generated yet.",
    generateFail: "Couldn't generate the site. Please try again.",
    generatingLong: "generating site… (may take 1-2 min)",
    elapsedLabel: "elapsed",
    loadingLabel: "Loading…",
  },
  es: {
    title: "Studio",
    subtitle: "Genera sitios a partir de una descripción.",
    specPlaceholder: "Describe el sitio: p. ej. landing page para una cafetería moderna...",
    generateBtn: "Generar sitio",
    previewPrefix: "Vista previa:",
    previewTitle: "vista previa",
    download: "Descargar",
    open: "Abrir",
    artifacts: "Artefactos",
    empty: "Aún no se ha generado ningún sitio.",
    generateFail: "No se pudo generar el sitio. Inténtalo de nuevo.",
    generatingLong: "generando sitio… (puede tardar 1-2 min)",
    elapsedLabel: "transcurrido",
    loadingLabel: "Cargando…",
  },
};

export default function Studio({ supabase, onGenerate }) {
  const t = useT(STRINGS);
  const [spec, setSpec] = useState("");
  const [generating, setGenerating] = useState(false);
  const [current, setCurrent] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);

  // Feedback de operação longa: cronômetro enquanto o site é gerado (1-2 min).
  useEffect(() => {
    if (!generating) return;
    setElapsed(0);
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [generating]);

  function fmtElapsed(s) {
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  async function loadArtifacts() {
    try {
      const { data } = await supabase
        .from("mz_artifacts")
        .select("id,title,model,created_at,content")
        .eq("kind", "site")
        .order("created_at", { ascending: false })
        .limit(20);
      setArtifacts(data || []);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadArtifacts();
  }, []);

  async function handleGenerate() {
    if (!spec.trim()) return;
    setError("");
    setGenerating(true);
    try {
      const res = await onGenerate(spec.trim());
      if (res && res.html) {
        setCurrent({
          html: res.html,
          title: res.title || spec.trim(),
          artifact_id: res.artifact_id,
        });
        loadArtifacts();
      } else {
        setError(t.generateFail);
      }
    } catch {
      setError(t.generateFail);
    } finally {
      setGenerating(false);
    }
  }

  function download() {
    if (!current) return;
    const blob = new Blob([current.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (current.title || "site") + ".html";
    a.click();
    URL.revokeObjectURL(url);
  }

  function openPreview() {
    if (!current) return;
    const w = window.open();
    w.document.write(current.html);
    w.document.close();
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

      {/* Composer */}
      <div className="flex flex-col gap-2">
        <textarea
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          placeholder={t.specPlaceholder}
          rows={3}
          className="w-full border border-input bg-background rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        />
        <button
          disabled={generating || !spec.trim()}
          onClick={handleGenerate}
          className="bg-teal-600 text-white rounded-lg px-4 py-2 text-sm hover:bg-teal-700 disabled:opacity-60 inline-flex items-center gap-2 self-start"
        >
          {generating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Wand2 className="w-4 h-4" />
          )}
          {t.generateBtn}
        </button>
        {generating && (
          <span
            className="text-xs text-muted-foreground inline-flex items-center gap-1.5"
            role="status"
            aria-live="polite"
          >
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            {t.generatingLong}
            <span className="tabular-nums">· {fmtElapsed(elapsed)} {t.elapsedLabel}</span>
          </span>
        )}
        {error && (
          <div
            role="alert"
            className="inline-flex items-center gap-2 self-start rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle size={16} aria-hidden="true" />
            {error}
          </div>
        )}
      </div>

      {/* Preview */}
      {current && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">
              {t.previewPrefix} {current.title}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={download}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <Download className="w-4 h-4" />
                {t.download}
              </button>
              {current.artifact_id && (
                <button
                  onClick={openPreview}
                  className="inline-flex items-center gap-1 text-sm text-teal-600 hover:text-teal-700"
                >
                  <ExternalLink className="w-4 h-4" />
                  {t.open}
                </button>
              )}
            </div>
          </div>
          <iframe
            title={t.previewTitle}
            srcDoc={current.html}
            className="w-full h-[500px] border border-border rounded-xl bg-white"
            sandbox="allow-scripts"
          />
        </div>
      )}

      {/* Artifacts */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">
          {t.artifacts}
        </h2>
        {loading ? (
          <div className="flex justify-center py-4" role="status">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t.loadingLabel}</span>
          </div>
        ) : artifacts.length > 0 ? (
          <div className="flex flex-col gap-2">
            {artifacts.map((a) => (
              <button
                key={a.id}
                className="flex flex-col gap-1 text-left rounded-xl border border-border bg-card p-3 hover:border-teal-300 w-full"
                onClick={() =>
                  setCurrent({
                    html: a.content,
                    title: a.title,
                    artifact_id: a.id,
                  })
                }
              >
                <div className="flex min-w-0 items-center gap-2">
                  <FileCode className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                  <span className="font-medium truncate">{a.title}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {a.model} &middot;{" "}
                  {new Date(a.created_at).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t.empty}</p>
        )}
      </div>
    </div>
  );
}
