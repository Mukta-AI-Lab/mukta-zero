// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// arc-samplen.cjs — RANK-1 (pós-workflow wvztksit4): amostragem INDEPENDENTE diversa SEM early-stop,
// p/ MEDIR o fork GERAÇÃO-vs-SELEÇÃO antes de gastar no raise-k cheio (prove-before-build).
// Hoje solveTask PARA no 1º train_verified (break) → nunca há pool. Aqui: K draws independentes (temps diversos,
// SEM feedback entre eles), roda CADA no G3, coleta TODO o pool train_verified + suas grades predicted.
// Régua em camadas por task: n_emit, n_trainpass, n_solve, distinct_trainpass_grids, selection_ceiling
//   (=pool contém ≥1 programa que train-verifica E resolve — o teto que um seletor perfeito atingiria).
// Fork: trainpass@k alto MAS solve baixo + selection_ceiling alto = parede de SELEÇÃO. Poucos trainpass = parede de GERAÇÃO.
// SSOT .107 anti-PRO (resolve107). Verificação-por-execução no G3 (train antes do test = zero leakage; GT só no scoring).
const TEMPS = [0.0, 0.3, 0.5, 0.7, 0.9, 1.0, 0.2, 0.6, 0.4, 0.8]; // schedule de diversidade (greedy-first + ascendente)

function makeSampleNSolver(deps) {
  const { SYS, buildProgram, runG3, parseArc, gEq, trainFeedback, rt, brain, CFG, renderGrid, dims } = deps;
  const EXEC_NOTE = CFG.execTool ? "A DETERMINISTIC helper get_objects(grid) is ALREADY DEFINED and callable (takes ONLY grid; returns a LIST OF DICTS obj['color']/obj['size']/obj['bbox'] ([r0,c0,r1,c1])/obj['cells']; use DICT KEYS; 4-connected same-color, background excluded). CALL it instead of re-implementing connected-components.\n\n" : "";
  const ct = (r) => (r.usage && r.usage.completion_tokens) || "?";

  return async function solveTaskSampleN(model, sem, token, taskId, taskObj, baseTemp) {
    const t0 = Date.now(); const K = CFG.sampleN;
    const trainRender = taskObj.train.map((pr, i) =>
      "# Example " + (i + 1) + "\nINPUT (" + dims(pr.input) + "):\n" + renderGrid(pr.input) + "\nOUTPUT (" + dims(pr.output) + "):\n" + renderGrid(pr.output)).join("\n\n");
    const testRender = taskObj.test.map((t, i) =>
      "# Test " + (i + 1) + " (apply transform; expected output HIDDEN)\nINPUT (" + dims(t.input) + "):\n" + renderGrid(t.input)).join("\n\n");
    const trainJson = JSON.stringify(taskObj.train.map((pr) => ({ input: pr.input, output: pr.output })));
    const testsJson = JSON.stringify(taskObj.test.map((t) => t.input));
    const gt = taskObj.test.map((t) => t.output);
    const user = EXEC_NOTE + "Training examples (grids as rows of digits 0-9):\n\n" + trainRender + "\n\n" + testRender + "\n\nInfer the single rule and write def transform(grid). Output ONLY one ```python code block.";

    const pool = []; let nEmit = 0, nTrain = 0, nSolve = 0, solvedUnion = false, anyTrain = false;
    for (let i = 0; i < K; i++) {
      const temp = TEMPS[i % TEMPS.length];
      const resp = await brain.dispatch107(model, { system: SYS, user, temperature: temp, max_tokens: CFG.maxTokens, timeoutMs: CFG.brainTimeout });
      if (!resp.ok || !resp.rawText) { pool.push({ i, temp, emit: false, err: "brain_empty(st=" + resp.status + ",ct=" + ct(resp) + ")" }); continue; }
      const code = rt.extractCode(resp.rawText);
      if (!code || code.replace(/\s/g, "").length < 12 || !/def\s+transform\s*\(/.test(code)) { pool.push({ i, temp, emit: false, err: "no_code" }); continue; }
      nEmit++;
      const r = await runG3(sem, token, buildProgram(trainJson, testsJson, code));
      const parsed = parseArc(r.stdout);
      if (!parsed) { pool.push({ i, temp, emit: true, exec_error: true }); continue; }
      const tv = !!parsed.train_verified;
      let solved = false, predHash = null;
      if (tv) {
        anyTrain = true; nTrain++;
        const pred = parsed.predicted || [];
        predHash = JSON.stringify(pred);
        solved = pred.length === gt.length && pred.every((p, j) => p !== null && gEq(p, gt[j]));
        if (solved) { nSolve++; solvedUnion = true; }
      }
      pool.push({ i, temp, emit: true, train_verified: tv, solved, calls_get_objects: /get_objects\s*\(/.test(code), code_len: code.length, code_min_len: code.replace(/\s+/g, "").length, pred_hash: predHash });
    }
    const distinct = new Set(pool.filter((p) => p.train_verified).map((p) => p.pred_hash)).size;
    return {
      task: taskId, solved: solvedUnion, attempts: K, train_verified: anyTrain, latency_ms: Date.now() - t0,
      n_test: taskObj.test.length, last_error: solvedUnion ? null : (anyTrain ? "test_mismatch" : (nEmit ? "no_trainpass" : "emission")),
      mismatch_reason: null, pipeline: "sample_n",
      samplen: { k: K, n_emit: nEmit, n_trainpass: nTrain, n_solve: nSolve, distinct_trainpass_grids: distinct, selection_ceiling: nSolve > 0, pool },
    };
  };
}
module.exports = { makeSampleNSolver };
