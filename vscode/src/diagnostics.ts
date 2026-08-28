// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview Pure diagnostics mapper — turns the *parsed* combined report
 * from mz-cli's `combineReport()` (src/review.mjs, json mode:
 * `JSON.parse(combineReport(local, cloud, filename, true).text)`) into a
 * flat, VS-Code-agnostic shape.
 *
 * Deliberately does NOT `import "vscode"` — this file (and its logic) is
 * unit-testable with plain `node test/diagnostics.test.mjs`, no Extension
 * Development Host required. `extension.ts` maps the neutral shape onto
 * `vscode.Diagnostic` at the boundary.
 */

export type NeutralSeverity = "error" | "warning" | "info";

export interface NeutralDiagnostic {
  /** 0-based line number, clamped to [0, lineCount-1] of the document text. */
  line: number;
  severity: NeutralSeverity;
  message: string;
  /** "mz-local" = offline signature gate (mao local). "mz-cloud" = semantic cloud review (cerebro nuvem). */
  source: "mz-local" | "mz-cloud";
}

interface LocalFinding {
  rule?: string;
  cwe?: string;
  severity?: string;
  line?: number | null;
  message?: string;
  snippet?: string;
}

interface CloudFinding {
  cwe?: string;
  severity?: string;
  line?: number | null;
  why?: string;
  message?: string;
  recommendation?: string;
}

/** Shape of `JSON.parse(combineReport(...).text)` — see mz-cli/src/review.mjs combineReport(). */
export interface CombinedReportLike {
  local?: { findings?: LocalFinding[] | null } | null;
  cloud?: { findings?: CloudFinding[] | null; skipped?: boolean } | null;
}

// Mirrors SEVERITY_RANK in mz-cli/src/review.mjs: block/critical/high -> error,
// warn/medium -> warning, low/info (or unknown) -> info.
const SEVERITY_MAP: Record<string, NeutralSeverity> = {
  block: "error",
  critical: "error",
  high: "error",
  warn: "warning",
  medium: "warning",
  low: "info",
  info: "info",
};

function mapSeverity(raw: string | undefined | null): NeutralSeverity {
  const key = String(raw || "").toLowerCase();
  return SEVERITY_MAP[key] ?? "info";
}

function countLines(documentText: string | null | undefined): number {
  if (!documentText) return 1;
  return documentText.split("\n").length;
}

/** Findings carry a 1-based line number; VS Code Ranges are 0-based. Clamp into [0, lineCount-1]. */
function clampLine(rawLine: number | null | undefined, lineCount: number): number {
  const maxIndex = Math.max(0, lineCount - 1);
  if (rawLine === null || rawLine === undefined || !Number.isFinite(rawLine)) return 0;
  const zeroBased = Math.trunc(rawLine) - 1;
  if (zeroBased < 0) return 0;
  if (zeroBased > maxIndex) return maxIndex;
  return zeroBased;
}

/**
 * Converts the combined mz-cli review report into a flat array of neutral
 * diagnostics. Tolerant of malformed/partial input (missing sections, a
 * skipped cloud pass, non-array findings) — never throws, worst case
 * returns [].
 */
export function findingsToDiagnostics(
  combined: CombinedReportLike | null | undefined,
  documentText: string
): NeutralDiagnostic[] {
  const lineCount = countLines(documentText);
  const out: NeutralDiagnostic[] = [];

  const localFindings = Array.isArray(combined?.local?.findings) ? (combined!.local!.findings as LocalFinding[]) : [];
  for (const f of localFindings) {
    const label = f.cwe || f.rule || "mz-local";
    out.push({
      line: clampLine(f.line, lineCount),
      severity: mapSeverity(f.severity),
      message: `[${label}] ${f.message || "(sem descrição)"}`,
      source: "mz-local",
    });
  }

  const cloudFindings = Array.isArray(combined?.cloud?.findings) ? (combined!.cloud!.findings as CloudFinding[]) : [];
  for (const f of cloudFindings) {
    const label = f.cwe || "mz-cloud";
    const why = f.why || f.message || "(sem descrição)";
    const rec = f.recommendation ? ` — recomendação: ${f.recommendation}` : "";
    out.push({
      line: clampLine(f.line, lineCount),
      severity: mapSeverity(f.severity),
      message: `[${label}] ${why}${rec}`,
      source: "mz-cloud",
    });
  }

  return out;
}
