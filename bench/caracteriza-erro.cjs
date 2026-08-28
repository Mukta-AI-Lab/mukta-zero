// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// caracteriza-erro.cjs — EV-3, frente A: transforma o diff CRU num FACTO DECLARADO.
//
// O PROBLEMA MEDIDO (13 tarefas, 2026-08-04): oito falham por REGRA errada, e três delas erram
// menos de 5% das células — a regra está quase certa e falha num caso de borda. O retorno que o
// modelo recebia era as duas grades inteiras, lado a lado, para ele achar a diferença sozinho.
// Numa grade 30×30 com 3% de erro são ~25 células divergentes em 900: busca visual pura, que gasta
// exactamente o orçamento de raciocínio que falta.
//
// Isto não verifica a regra — regra em prosa não é executável. Faz outra coisa, e é a que o regime
// de guia sabe fazer: **o harness mede, o modelo decide**. Em vez de "acha aí", diz
// "as 25 células erradas são TODAS de cor 3 que deviam ser 7, e TODAS na última linha de cada objecto".
//
// Nada aqui olha para a saída de TESTE. Só compara o que o programa produziu com o par de TREINO,
// que o modelo já tem no prompt.
'use strict';

const conta = (arr) => { const h = {}; for (const x of arr) h[x] = (h[x] || 0) + 1; return h; };
const topo = (h, n) => Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, n);

function caracteriza(esperado, obtido) {
  if (!esperado || !obtido || !esperado.length || !obtido.length) return null;
  if (esperado.length !== obtido.length || esperado[0].length !== obtido[0].length) return null;
  const H = esperado.length, W = esperado[0].length;
  const errs = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++)
    if (esperado[r][c] !== obtido[r][c]) errs.push({ r, c, esp: esperado[r][c], obt: obtido[r][c] });
  if (!errs.length) return null;

  const L = [];
  const pct = (100 * errs.length / (H * W)).toFixed(1);
  L.push(errs.length + ' de ' + (H * W) + ' células erradas (' + pct + '%)');

  // ── PADRÃO DE COR — o mais accionável dos três: diz a substituição exacta que falta ──────────
  const pares = conta(errs.map((e) => e.obt + '→' + e.esp));
  const tp = topo(pares, 3);
  if (tp[0][1] === errs.length) L.push('TODAS são a MESMA troca: você pôs ' + tp[0][0].split('→')[0]
    + ' onde devia ser ' + tp[0][0].split('→')[1]);
  else L.push('trocas (você→esperado): ' + tp.map(([k, v]) => k + ' ×' + v).join(' · '));

  // ── PADRÃO DE POSIÇÃO ────────────────────────────────────────────────────────────────────────
  const linhas = [...new Set(errs.map((e) => e.r))], cols = [...new Set(errs.map((e) => e.c))];
  const naBorda = errs.filter((e) => e.r === 0 || e.c === 0 || e.r === H - 1 || e.c === W - 1).length;
  if (linhas.length === 1) L.push('TODAS na linha ' + linhas[0]);
  else if (cols.length === 1) L.push('TODAS na coluna ' + cols[0]);
  else if (naBorda === errs.length) L.push('TODAS na BORDA da grade');
  else if (naBorda === 0) L.push('NENHUMA na borda — todas no interior');
  else L.push('espalhadas por ' + linhas.length + ' linha(s) e ' + cols.length + ' coluna(s)');

  // ── O QUE VOCÊ NÃO MEXEU vs MEXEU A MAIS ────────────────────────────────────────────────────
  // distinguir "faltou aplicar" de "aplicou onde não devia" muda a correcção inteira, e o modelo
  // não consegue ver isso olhando para duas grades.
  const fundoEsp = topo(conta(esperado.flat()), 1)[0][0];
  const faltou = errs.filter((e) => String(e.obt) === String(fundoEsp)).length;
  const demais = errs.filter((e) => String(e.esp) === String(fundoEsp)).length;
  if (faltou && !demais) L.push('→ você DEIXOU DE PINTAR: em todas, o seu valor é o fundo e o esperado não é');
  else if (demais && !faltou) L.push('→ você PINTOU A MAIS: em todas, o esperado é o fundo e o seu valor não é');
  else if (faltou || demais) L.push('→ ' + faltou + ' onde faltou pintar · ' + demais + ' onde pintou a mais');

  const amostra = errs.slice(0, 8).map((e) => '(' + e.r + ',' + e.c + ') seu=' + e.obt + ' esp=' + e.esp).join(' · ');
  L.push('amostra: ' + amostra + (errs.length > 8 ? '  … (+' + (errs.length - 8) + ')' : ''));
  return L.join('\n     ');
}

module.exports = { caracteriza };
