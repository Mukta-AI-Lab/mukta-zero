// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// surgical-edit.ts — edição PONTUAL de DOCX/PPTX preservando toda a estrutura (padrão do Studio: mexe só no conteúdo de <w:t>/<a:t>).
// Para texto multi-run (que atravessa vários <w:r>), usar o casamento tolerante do _shared/ooxml-engine.ts (a portar). Aqui: caso single-run (maioria).
import { unzipSync, zipSync, strToU8, strFromU8 } from "https://esm.sh/fflate@0.8.2";

export interface SurgicalEdit { from: string; to: string }
export interface SurgicalResult { bytes: Uint8Array; subs: number; struct_identical: boolean; texts_changed: number; texts_intact: number; other_parts_identical: boolean }

/** Edita SÓ o conteúdo de texto (dentro de <w:t> no DOCX ou <a:t> no PPTX), preservando tags/rPr/estrutura/outras partes. */
export function surgicalEdit(fileBytes: Uint8Array, edits: SurgicalEdit[], opts?: { xmlPath?: string; tag?: "w:t" | "a:t" }): SurgicalResult {
  const xmlPath = opts?.xmlPath ?? "word/document.xml";
  const tag = opts?.tag ?? "w:t";
  const zip = unzipSync(fileBytes);
  const before = strFromU8(zip[xmlPath]);
  const re = new RegExp(`(<${tag}[^>]*>)([^<]*)(</${tag}>)`, "g");
  const texts = (s: string) => (s.match(re) || []).map((m) => m.replace(/<[^>]*>/g, ""));
  const struct = (s: string) => JSON.stringify(["<w:p>", "<w:r>", `<${tag}`, "<w:tbl>", "<w:tr>", "<a:p>", "<a:r>"].map((t) => s.split(t).length - 1));
  const tBefore = texts(before), sBefore = struct(before);
  let subs = 0;
  const after = before.replace(re, (full, open, text, close) => {
    let t = text;
    for (const e of edits) if (t.includes(e.from)) { t = t.split(e.from).join(e.to); subs++; }
    return open + t + close;
  });
  const newZip = { ...zip }; newZip[xmlPath] = strToU8(after);
  const bytes = zipSync(newZip, { level: 6 });
  const tAfter = texts(after);
  let changed = 0, intact = 0;
  for (let i = 0; i < Math.max(tBefore.length, tAfter.length); i++) (tBefore[i] !== tAfter[i] ? changed++ : intact++);
  let otherIdentical = true;
  for (const k of Object.keys(zip)) { if (k === xmlPath) continue; if (zip[k].length !== newZip[k].length) { otherIdentical = false; break; } }
  return { bytes, subs, struct_identical: sBefore === struct(after), texts_changed: changed, texts_intact: intact, other_parts_identical: otherIdentical };
}
