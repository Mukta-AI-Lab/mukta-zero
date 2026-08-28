// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// audit-sink.cjs — SINK DE AUDITORIA append-only NÃO-DESLIGÁVEL do refusal-gate (Carta §Plano 4).
// Contrato: append(event) grava SEMPRE, incondicionalmente, num destino append-only, hash-encadeado, fora da
// autoridade de reescrita do processo do agente. Retorna true SSE a gravação foi confirmada; NUNCA lança.
//   DEV/offline (aqui): JSONL local hash-encadeado em scripts/agent/out/refusal-events.jsonl — cada linha guarda
//     prev_hash + row_hash; append puro (nunca trunca/reescreve). Detecção de adulteração via verifyChain().
//   PROD (🔨 wiring): RPC service_role → tabela public.refusal_events (mesma hash-chain, trigger BEFORE UPDATE/DELETE
//     → RAISE; âncora externa periódica). Migration em supabase/migrations/*_refusal_audit_grants.sql (aplicar SÓ via
//     MCP apply_migration). O sink NÃO aceita substituição injetável do destino canônico (fecha o furo #12 do red-team).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OUT_DIR = path.join(__dirname, "out");
const SINK = path.join(OUT_DIR, "refusal-events.jsonl");
const GENESIS = "0".repeat(64);

// último row_hash da cadeia (lê a última linha; genesis se vazio). Best-effort, nunca lança.
function tailHash() {
  try {
    if (!fs.existsSync(SINK)) return GENESIS;
    const buf = fs.readFileSync(SINK, "utf8").trimEnd();
    if (!buf) return GENESIS;
    const last = buf.slice(buf.lastIndexOf("\n") + 1);
    const j = JSON.parse(last);
    return typeof j.row_hash === "string" && j.row_hash.length === 64 ? j.row_hash : GENESIS;
  } catch { return GENESIS; }
}

// grava um evento sanitizado, encadeado. Retorna true sse confirmou a escrita.
function append(event) {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const prev_hash = tailHash();
    const base = { ...event, prev_hash };
    const row_hash = crypto.createHash("sha256").update(prev_hash + "\0" + JSON.stringify(event)).digest("hex");
    fs.appendFileSync(SINK, JSON.stringify({ ...base, row_hash }) + "\n", "utf8");
    return true;
  } catch { return false; }
}

// caminha a cadeia inteira, recomputa cada row_hash, retorna {ok, brokenAt, total}. Guard vivo de integridade.
function verifyChain() {
  try {
    if (!fs.existsSync(SINK)) return { ok: true, total: 0 };
    const lines = fs.readFileSync(SINK, "utf8").split("\n").filter(Boolean);
    let prev = GENESIS;
    for (let i = 0; i < lines.length; i++) {
      const j = JSON.parse(lines[i]);
      const { row_hash, prev_hash, ...event } = j;
      const recomputed = crypto.createHash("sha256").update(prev + "\0" + JSON.stringify(event)).digest("hex");
      if (prev_hash !== prev || row_hash !== recomputed) return { ok: false, brokenAt: i, total: lines.length };
      prev = row_hash;
    }
    return { ok: true, total: lines.length };
  } catch (e) { return { ok: false, error: String(e.message) }; }
}

module.exports = { append, verifyChain, SINK };
