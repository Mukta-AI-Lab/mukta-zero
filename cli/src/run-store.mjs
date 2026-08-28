// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli run-store — histórico de runs POR SESSÃO/aba, p/ abertura
 * + observabilidade. Cada comando substantivo grava uma linha em runs.jsonl do
 * store da sessão corrente (ver session.mjs). É como o histórico de um shell:
 * local, na máquina do usuário, escopado à aba — nunca vai ao servidor.
 *
 * Registra METADADOS (comando, input truncado, exit, duração, ts), não a saída
 * completa — o suficiente p/ observar "o que rodou, quando, com que resultado".
 */
import { appendSessionLine, readSessionLines, listSessions } from "./session.mjs";
import crypto from "node:crypto";

/** Anexa um registro de run à sessão corrente. Retorna o id. Best-effort (chamado no exit). */
export function recordRun(rec) {
  const id = crypto.randomBytes(4).toString("hex");
  appendSessionLine("runs.jsonl", { id, ts: new Date().toISOString(), ...rec });
  return id;
}

/** Os `limit` runs mais recentes da sessão corrente (mais novo primeiro). */
export function listRuns(limit = 30) {
  return readSessionLines("runs.jsonl", limit);
}

/** Um run por id (busca nos últimos 1000). */
export function getRun(id) {
  return listRuns(1000).find((r) => r.id === id) || null;
}

export { listSessions };
