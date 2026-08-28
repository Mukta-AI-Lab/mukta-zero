// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// lcb-checkers.cjs — VERIFICADORES POR PROPRIEDADE para os problemas de JUIZ ESPECIAL.
//
// O DÉCIMO SÉTIMO INSTRUMENTO SILENCIOSO. 19 das 248 tarefas hard dizem literalmente no enunciado
// "if there are multiple solutions, you may print any of them" — e o oráculo comparava com a string
// do gabarito. Quando o modelo acerta com OUTRA construção válida, eu contava erro. Medido:
//   abc333_e  esperado "3 1 1 1 0 0 1 0 1"   obtido "3 0 0 1 1 1 0 1 1"   ← o ótimo (3) BATE
//   abc343_e  "Yes 0 0 0 0 6 0 6 0 0"    ×  "Yes 0 0 0 -6 -6 0 -6 0 0"    ← cubos noutra posição
//   abc373_g  "2 1 3"  ×  "1 2 3"        ← o próprio enunciado lista 1 2 3 como válido
//   abc363_f  "11*3*11" × "363"          ← ambos palíndromos que valem 363
//
// DISCIPLINA OBRIGATÓRIA — e ela é o que separa isto de mais um instrumento defeituoso:
// TODO verificador tem de APROVAR O PRÓPRIO GABARITO. Um verificador que reprova a resposta oficial
// está errado; um verificador permissivo demais é PIOR que o estado atual, porque credita resposta
// errada. `autoTeste()` roda essa checagem contra os casos oficiais e é pré-condição de uso.
//
// Cada verificador recebe (entrada, saída) e devolve true/false/null. `null` = "não sei julgar",
// e nesse caso o chamador DEVE cair de volta na comparação exata — nunca aprovar por dúvida.

// ── geometria: os segmentos AB e CD se cruzam? (pontos em posição geral, sem três colineares) ─────
function cruza(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4;
}
const nums = (s) => String(s).trim().split(/\s+/).filter(Boolean).map(Number);

// Emparelhamento perfeito em ÁRVORE: existe sse o guloso das folhas consome todos os vértices —
// casa cada folha com seu pai, remove os dois, repete. Se sobrar vértice sem par, não existe.
// (Trabalha sobre cópias; não altera a adjacência do chamador.)
function temEmparelhamentoPerfeito(adj, vivos) {
  if (vivos.size === 0) return true;
  if (vivos.size % 2 === 1) return false;
  const g = new Map(); for (const v of vivos) g.set(v, new Set(adj.get(v) || []));
  const restam = new Set(vivos);
  let fila = [...restam].filter((v) => g.get(v).size === 1);
  while (restam.size) {
    fila = fila.filter((v) => restam.has(v) && g.get(v).size === 1);
    if (!fila.length) return false;                 // sobrou ciclo/isolado → sem emparelhamento
    const f = fila.pop();
    const pai = [...g.get(f)][0];
    if (pai === undefined) return false;            // folha isolada → sem par
    for (const v of [f, pai]) { for (const w of g.get(v)) g.get(w).delete(v); g.delete(v); restam.delete(v); }
    for (const v of restam) if (g.get(v).size === 1) fila.push(v);
    if (restam.size && !fila.length) { fila = [...restam].filter((v) => g.get(v).size === 1); }
  }
  return true;
}

const CHECKERS = {
  // ── abc373_g · No Cross Matching ────────────────────────────────────────────────────────────────
  // R é permutação de 1..N e os segmentos P_i–Q_{R_i} não se cruzam dois a dois.
  abc373_g(entrada, saida) {
    const e = nums(entrada), s = String(saida).trim();
    const N = e[0];
    if (s === "-1") return null;                        // "não existe" exige prova; não julgo
    const R = nums(s);
    if (R.length !== N) return false;
    if (new Set(R).size !== N || R.some((x) => x < 1 || x > N)) return false;
    const P = [], Q = [];
    for (let i = 0; i < N; i++) P.push([e[1 + 2 * i], e[2 + 2 * i]]);
    for (let i = 0; i < N; i++) Q.push([e[1 + 2 * N + 2 * i], e[2 + 2 * N + 2 * i]]);
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++)
      if (cruza(P[i], Q[R[i] - 1], P[j], Q[R[j] - 1])) return false;
    return true;
  },

  // ── abc343_e · 7x7x7 ────────────────────────────────────────────────────────────────────────────
  // Três cubos de lado 7 com |coord| ≤ 100; os volumes cobertos por exatamente 1, 2 e 3 cubos têm de
  // dar V1, V2, V3. Volume de interseção de caixas alinhadas é produto das sobreposições por eixo.
  abc343_e(entrada, saida) {
    const [V1, V2, V3] = nums(entrada);
    const linhas = String(saida).trim().split("\n").map((x) => x.trim()).filter(Boolean);
    if (/^no$/i.test(linhas[0] || "")) return null;     // "não existe" exige prova
    if (!/^yes$/i.test(linhas[0] || "")) return false;
    const c = nums(linhas.slice(1).join(" "));
    if (c.length !== 9 || c.some((x) => Math.abs(x) > 100 || !Number.isInteger(x))) return false;
    const cubo = (k) => [c[3 * k], c[3 * k + 1], c[3 * k + 2]];
    const inter = (ks) => {                              // volume da interseção dos cubos em ks
      let v = 1;
      for (let eixo = 0; eixo < 3; eixo++) {
        const lo = Math.max(...ks.map((k) => cubo(k)[eixo]));
        const hi = Math.min(...ks.map((k) => cubo(k)[eixo] + 7));
        v *= Math.max(0, hi - lo);
      }
      return v;
    };
    const s1 = inter([0]) + inter([1]) + inter([2]);
    const s2 = inter([0, 1]) + inter([0, 2]) + inter([1, 2]);
    const s3 = inter([0, 1, 2]);
    // inclusão–exclusão: exatamente-3 = s3; exatamente-2 = s2 − 3·s3; exatamente-1 = s1 − 2·s2 + 3·s3
    return (s3 === V3) && (s2 - 3 * s3 === V2) && (s1 - 2 * s2 + 3 * s3 === V1);
  },

  // ── abc363_f · Palindromic Expression ───────────────────────────────────────────────────────────
  // S é palíndromo, só dígitos 1..9 e '*', e o valor da expressão é N.
  abc363_f(entrada, saida) {
    const N = BigInt(nums(entrada)[0]);
    const s = String(saida).trim();
    if (s === "-1") return null;
    if (!/^[1-9*]+$/.test(s)) return false;
    if (s !== [...s].reverse().join("")) return false;
    const partes = s.split("*");
    if (partes.some((p) => p.length === 0)) return false;
    let v = 1n; for (const p of partes) v *= BigInt(p);
    return v === N;
  },

  // ── arc181_c · Row and Column Order ─────────────────────────────────────────────────────────────
  // Grade N×N de 0/1: linhas em ordem lexicográfica crescente segundo P, colunas segundo Q.
  arc181_c(entrada, saida) {
    const e = nums(entrada), N = e[0];
    const P = e.slice(1, 1 + N), Q = e.slice(1 + N, 1 + 2 * N);
    const linhas = String(saida).trim().split("\n").map((x) => x.trim().replace(/\s+/g, "")).filter(Boolean);
    if (linhas.length !== N || linhas.some((l) => l.length !== N || !/^[01]+$/.test(l))) return false;
    const col = (j) => linhas.map((l) => l[j]).join("");
    for (let i = 0; i + 1 < N; i++) if (!(linhas[P[i] - 1] < linhas[P[i + 1] - 1])) return false;
    for (let i = 0; i + 1 < N; i++) if (!(col(Q[i] - 1) < col(Q[i + 1] - 1))) return false;
    return true;
  },

  // ── abc333_e · Takahashi Quest ──────────────────────────────────────────────────────────────────
  // Estava no grupo de juiz especial e NÃO TINHA verificador — eu declarei isso como lacuna no dossiê
  // Valida: (1) o K impresso bate com o do gabarito; (2) a sequência de pegar/descartar é EXECUTÁVEL
  // (nunca usa poção que não tem); (3) o pico de poções carregadas é exatamente esse K.
  abc333_e(entrada, saida, esperado) {
    const e = nums(entrada), N = e[0];
    const ev = []; for (let i = 0; i < N; i++) ev.push([e[1 + 2 * i], e[2 + 2 * i]]);
    const meu = String(saida).trim().split("\n").map((x) => x.trim());
    const gab = String(esperado).trim().split("\n").map((x) => x.trim());
    if (gab[0] === "-1" || meu[0] === "-1") return meu[0] === gab[0] ? true : false;
    if (Number(meu[0]) !== Number(gab[0])) return false;         // o ótimo K tem de bater
    const acoes = nums(meu.slice(1).join(" "));
    const achados = ev.filter(([t]) => t === 1).length;
    if (acoes.length !== achados || acoes.some((a) => a !== 0 && a !== 1)) return false;
    const bolsa = new Map(); let k = 0, pico = 0, idx = 0;
    for (const [t, x] of ev) {
      if (t === 1) { if (acoes[idx++] === 1) { bolsa.set(x, (bolsa.get(x) || 0) + 1); k++; if (k > pico) pico = k; } }
      else { const q = bolsa.get(x) || 0; if (q === 0) return false; bolsa.set(x, q - 1); k--; }
    }
    return pico === Number(gab[0]);
  },

  // ── arc183_d · Keep Perfectly Matched ───────────────────────────────────────────────────────────
  // N/2 operações, cada uma remove DUAS FOLHAS da árvore atual, e o que sobra tem de manter
  // emparelhamento perfeito. Pontuação = soma das distâncias, e tem de ser MÁXIMA — o valor ótimo é
  // extraído do próprio gabarito, que é a única fonte de verdade disponível aqui.
  arc183_d(entrada, saida, esperado) {
    const e = nums(entrada), N = e[0];
    const arestas = [];
    for (let i = 0; i < N - 1; i++) arestas.push([e[1 + 2 * i], e[2 + 2 * i]]);
    const simula = (txt) => {
      const adj = new Map(); for (let v = 1; v <= N; v++) adj.set(v, new Set());
      for (const [a, b] of arestas) { adj.get(a).add(b); adj.get(b).add(a); }
      const vivos = new Set(Array.from({ length: N }, (_, i) => i + 1));
      const ops = String(txt).trim().split("\n").map((l) => nums(l)).filter((x) => x.length === 2);
      if (ops.length !== N / 2) return null;
      let total = 0;
      for (const [x, y] of ops) {
        if (!vivos.has(x) || !vivos.has(y) || x === y) return null;
        if (adj.get(x).size !== 1 || adj.get(y).size !== 1) return null;   // ambos folhas AGORA
        // distância na árvore ATUAL, por BFS
        const dist = new Map([[x, 0]]); const fila = [x];
        while (fila.length) { const u = fila.shift(); for (const w of adj.get(u)) if (!dist.has(w)) { dist.set(w, dist.get(u) + 1); fila.push(w); } }
        if (!dist.has(y)) return null;
        total += dist.get(y);
        for (const v of [x, y]) { for (const w of adj.get(v)) adj.get(w).delete(v); adj.delete(v); vivos.delete(v); }
        // ⚠️ CONDIÇÃO QUE FALTAVA e que eu declarei como defeito no dossiê: o enunciado exige que a
        // árvore RESTANTE ainda tenha emparelhamento perfeito depois de cada remoção. Sem esta
        // checagem o verificador era PERMISSIVO — creditaria resposta inválida, que é pior que o
        // defeito original que ele veio consertar.
        // Em árvore, emparelhamento perfeito existe sse o guloso das folhas consome todos os
        // vértices: casa cada folha com seu pai e remove os dois, repetindo.
        if (!temEmparelhamentoPerfeito(adj, vivos)) return null;
      }
      return total;
    };
    const meu = simula(saida), otimo = simula(esperado);
    if (meu == null) return false;
    if (otimo == null) return null;          // não consigo pontuar o gabarito → não julgo
    return meu === otimo;
  },
};

// ── AUTOTESTE: o gabarito TEM de passar no próprio verificador ───────────────────────────────────
function autoTeste(tarefas) {
  const r = [];
  for (const [id, fn] of Object.entries(CHECKERS)) {
    const t = tarefas[id];
    if (!t) { r.push({ id, ok: false, nota: "tarefa ausente" }); continue; }
    let bons = 0, maus = 0, nulos = 0;
    for (const c of t.tests) {
      let v = null;
      try { v = fn(String(c.input), String(c.output), String(c.output)); } catch (e) { v = "ERRO:" + e.message; }
      if (v === true) bons++; else if (v === null) nulos++; else maus++;
    }
    r.push({ id, ok: maus === 0, bons, maus, nulos, nota: maus ? "REPROVA O PRÓPRIO GABARITO" : (nulos ? "aprovou " + bons + ", não julgou " + nulos : "aprovou todos") });
  }
  return r;
}

// ── INJULGÁVEIS: tarefas que ESTE instrumento não pode julgar, com o motivo ──────────────────────
// Sair do denominador é uma afirmação forte e precisa de prova por tarefa, não de conveniência.
// Cada linha aqui carrega a evidência que a sustenta.
const INJULGAVEIS = {
  // interativas: o programa deve consultar um juiz VIVO; alimentamos transcrição estática e ele lê a
  // linha errada. Enunciado: "This is an interactive problem (where your program interacts with the
  // judge via input and output)". Gastou 14 abordagens e 35 avaliações antes de eu perceber.
  abc355_e: "interativa — exige diálogo com o juiz, incompatível com entrada estática",
  abc337_e: "interativa — mesmo motivo",
  // ⚠️ DADO DO BENCHMARK INCONSISTENTE, provado por contagem e não por interpretação:
  // no 3º caso de teste há UMA poção do tipo 6 (evento 9) e UM monstro do tipo 6 (evento 30), e a
  // resposta OFICIAL manda DESCARTAR essa poção. O enunciado diz "If he does not defeat it, he will
  // be defeated" — não há releitura que salve. O gabarito não satisfaz a própria entrada.
  // Eu havia concluído que o meu verificador estava errado; ele estava certo.
  abc333_e: "dado inconsistente — a resposta oficial do 3º caso descarta a única poção tipo 6 e depois enfrenta o monstro tipo 6",
};

module.exports = { CHECKERS, autoTeste, INJULGAVEIS };
