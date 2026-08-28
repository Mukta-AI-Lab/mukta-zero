// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// arc-passk.cjs — Tier 3a: RÉGUA pass@k EM CAMADAS (estimador não-viesado de Chen et al.) + PROVENIÊNCIA.
// O ganho de MEDIÇÃO HONESTA que a investigação ARC flagou: separa emit@k → trainpass@k → solve@k, para
// distinguir parede de GERAÇÃO (solve@k não sobe) de parede de SELEÇÃO (trainpass@k >> solve@k). Determinístico,
// zero LLM, roda sobre pools JÁ capturados (--sample-n) ou multi-round. Estimador não-viesado (não a fração ingênua).
const fs = require("fs"), path = require("path");
const { execSync } = require("child_process");

// pass@k não-viesado (Chen 2021): 1 - C(n-c,k)/C(n,k). Estável numericamente via produto de razões.
function passAtK(n, c, k) {
  if (k > n) k = n;
  if (n - c < k) return 1.0;           // impossível NÃO acertar em k draws
  let p = 1.0;
  for (let i = 0; i < k; i++) p *= (n - c - i) / (n - i);
  return 1 - p;
}

// dado o pool de draws de UMA task, conta c por camada e devolve as curvas @1..n
function layeredForTask(pool) {
  const n = pool.length;
  const cEmit = pool.filter((p) => p.emit).length;
  const cTrain = pool.filter((p) => p.train_verified).length;
  const cSolve = pool.filter((p) => p.solved).length;
  const curve = (c) => Array.from({ length: n }, (_, i) => passAtK(n, c, i + 1));
  return { n, c_emit: cEmit, c_train: cTrain, c_solve: cSolve, emit_at_k: curve(cEmit), trainpass_at_k: curve(cTrain), solve_at_k: curve(cSolve) };
}

// agrega (média por-task) as curvas @k sobre todas as tasks com pool
function aggregate(perTask) {
  const rows = perTask.map((t) => (t.samplen && t.samplen.pool) ? layeredForTask(t.samplen.pool) : null).filter(Boolean);
  if (!rows.length) return null;
  const K = Math.min(...rows.map((r) => r.n));
  const mean = (key, k) => rows.reduce((a, r) => a + r[key][k], 0) / rows.length;
  const out = { tasks: rows.length, k_max: K, emit_at_k: [], trainpass_at_k: [], solve_at_k: [] };
  for (let k = 0; k < K; k++) { out.emit_at_k.push(mean("emit_at_k", k)); out.trainpass_at_k.push(mean("trainpass_at_k", k)); out.solve_at_k.push(mean("solve_at_k", k)); }
  // diagnóstico do FORK: gap de seleção = trainpass@Kmax - solve@Kmax (alto => há candidatos train-consistentes que não solvam = seleção; baixo => geração)
  out.selection_gap = out.trainpass_at_k[K - 1] - out.solve_at_k[K - 1];
  out.fork = out.solve_at_k[K - 1] < 0.05 ? "GERACAO (solve@k não sobe)" : (out.selection_gap > 0.2 ? "SELECAO (trainpass>>solve)" : "misto");
  return out;
}

function provenance(file) {
  let commit = "?"; try { commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch (e) {}
  let j = {}; try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
  return { git_commit: commit, model: j.model || null, split: j.split || null, seed: j.seed || null, source_file: path.basename(file), stamped_at_note: "carimbar timestamp fora do harness (Date indisponível no script)" };
}

module.exports = { passAtK, layeredForTask, aggregate, provenance };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error("uso: node scripts/agent/mz-bench/arc-passk.cjs <run-com-samplen.json>"); process.exit(1); }
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const agg = aggregate(j.per_task || []);
  const prov = provenance(file);
  if (!agg) { console.log("(sem pools --sample-n neste arquivo — a régua precisa de draws por task)"); process.exit(0); }
  const pct = (x) => (100 * x).toFixed(0) + "%";
  console.log("RÉGUA pass@k EM CAMADAS (" + agg.tasks + " tasks, k até " + agg.k_max + ") — estimador não-viesado\n");
  console.log("  k     emit@k   trainpass@k   solve@k");
  for (let k = 0; k < agg.k_max; k++) console.log("  " + String(k + 1).padEnd(4) + "  " + pct(agg.emit_at_k[k]).padStart(6) + "   " + pct(agg.trainpass_at_k[k]).padStart(9) + "   " + pct(agg.solve_at_k[k]).padStart(7));
  console.log("\n  selection_gap (trainpass@kmax - solve@kmax) = " + pct(agg.selection_gap) + "  →  FORK = " + agg.fork);
  console.log("  proveniência: commit=" + prov.git_commit + " model=" + (prov.model || "?").slice(0, 40) + " split=" + prov.split + " seed=" + prov.seed);
  fs.writeFileSync("scripts/agent/mz-bench/out/arc-passk.json", JSON.stringify({ aggregate: agg, provenance: prov }, null, 2));
  console.log("\n→ scripts/agent/mz-bench/out/arc-passk.json");
}
