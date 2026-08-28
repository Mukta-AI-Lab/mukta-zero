// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview Mukta Zero — persistência dos ESTADOS de execução (7b state-tuning).
 * Camada fs (supervisor) sobre a lógica PURA de state.mjs (autorada pelo MZ).
 * Estados vivem em ~/.mukta/states/<name>.json. Um estado só é usável quando status='approved'
 * (governança: user cria→aprova; agente propõe→humano aprova). A herança do CONTRATO de
 * execução (7a) é garantida no ponto de uso via sealedSystem(state.persona) — o estado NÃO
 * consegue remover as guardas (elas vêm ANTES da persona).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeState, validateState } from "./state.mjs";

const STATES_DIR = path.join(os.homedir(), ".mukta", "states");
function ensureDir() { if (!existsSync(STATES_DIR)) mkdirSync(STATES_DIR, { recursive: true }); }

/** Cria e persiste um estado (valida governança antes). approve=true marca como aprovado. */
export function saveState(input, { approve = false } = {}) {
  const st = makeState(input);
  const v = validateState(st);
  if (!v.ok) throw new Error(`estado rejeitado (${v.reason})`);
  st.created_at = new Date().toISOString();
  if (approve) st.status = "approved";
  ensureDir();
  writeFileSync(path.join(STATES_DIR, `${st.name}.json`), JSON.stringify(st, null, 2), "utf8");
  return st;
}

/** Lista todos os estados persistidos. */
export function listStates() {
  ensureDir();
  return readdirSync(STATES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => { try { return JSON.parse(readFileSync(path.join(STATES_DIR, f), "utf8")); } catch { return null; } })
    .filter(Boolean);
}

/** Só os estados aprovados (os únicos que o motor pode selecionar). */
export function loadApprovedStates() {
  return listStates().filter((s) => s && s.status === "approved");
}

/** Aprova um estado por nome (governança). */
export function approveState(name) {
  const p = path.join(STATES_DIR, `${name}.json`);
  if (!existsSync(p)) throw new Error(`estado não encontrado: ${name}`);
  const st = JSON.parse(readFileSync(p, "utf8"));
  st.status = "approved";
  writeFileSync(p, JSON.stringify(st, null, 2), "utf8");
  return st;
}

export { STATES_DIR };
