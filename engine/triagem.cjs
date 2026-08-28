// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// triagem.cjs — R0 do plano aprovado (W2.1): DOSAGEM DE TRILHA. "Quanto processo esta tarefa merece?"
//
// É o E0.3/V1–V5 do Vol I traduzido para a população do MZ — onde a variável que manda não é
// reversibilidade nem magnitude (as tarefas não tocam produção por si), e sim a V4 do documento:
// FEEDBACK DISPONÍVEL. Com oráculo executável, o mundo corrige na hora e o processo pode ser leve;
// sem oráculo, o único gate é o processo — e é aí que a trilha sobe.
//
// v1 É DETERMINÍSTICA POR INTEIRO, e isso é decisão, não limitação: um classificador LLM aqui seria
// um gate pago em toda tarefa (o anti-padrão "gate máximo em tudo") e introduziria variância no
// próprio mecanismo que decide quanta variância tolerar. Sinais lexicais são fracos de propósito —
// só sobem a trilha, nunca descem (fail-up).
//
// ⚠️ A JUSTIFICATIVA CORRIGIDA POR MEDIÇÃO (MZ-Eng, bateria F1, 2026-07-31): custo dos portões =
// 0,02% do trabalho (3,3s vs 13.362s). A dosagem COMO ECONOMIA está REFUTADA — não é para isso que
// este módulo existe. Ele existe pela V4: HABILITAR domínio SEM oráculo com segurança (a trilha
// reforçada liga verificação cross-family exatamente onde nenhum oráculo corrige), e dar à
// telemetria a dimensão de classe que a BTB precisa. Justificar pelo custo seria a 5ª classe.
//
// TRILHAS:
//   expressa  — single-shot barato. Curta, sem oráculo, sem sinal de risco.
//   padrao    — laço com oráculo (ou single-shot com verificação padrão quando não há oráculo).
//   reforcada — + antítese cross-family (R6) e/ou sample-K. Sem oráculo E (longa OU sinal de risco),
//               ou quando o chamador a força.
//
// A REGRA DE OURO (do próprio Vol I): o override do chamador SÓ SOBE. `opts.trilha` pode forçar
// reforçada numa tarefa que a triagem leu como expressa; NUNCA rebaixar — rebaixamento silencioso
// é como nasce o denominador sujo.
'use strict';

const RISCO = /\b(produ[cç][aã]o|migra(r|[cç][aã]o)|delet(e|ar)|drop\b|irrevers|apagar|remover conta|billing|cobran[cç]a|secret|credencial|chave)\b/i;

// `sinais` volta junto para a TELEMETRIA: a trilha sem o porquê é um número que parece resultado.
function triagem(task, opts = {}) {
  const t = String(task || '');
  const temOraculo = !!(opts && (opts.tests || (opts.pares && opts.pares.length)));
  const sinais = {
    tamanho_ch: t.length,
    tem_oraculo: temOraculo,
    sample_k: !!(opts && opts.sampleK && opts.sampleK > 1),
    risco_lexical: RISCO.test(t),
    override: opts && opts.trilha ? String(opts.trilha) : null,
  };

  let trilha;
  if (temOraculo) {
    // Com oráculo, o laço padrão JÁ é a dose certa — o feedback é imediato e barato.
    // Sobe para reforçada só por pedido explícito ou sample-K (o chamador já decidiu pagar).
    trilha = sinais.sample_k ? 'reforcada' : 'padrao';
  } else if (sinais.risco_lexical) {
    trilha = 'reforcada';                       // sem oráculo E com sinal de risco: o processo é o único gate
  } else if (t.length < 400) {
    trilha = 'expressa';                        // curta, sem oráculo, sem risco: o custo do processo > o do erro
  } else if (t.length > 4000) {
    trilha = 'reforcada';                       // longa sem oráculo: mais superfície de erro, nenhum corretor
  } else {
    trilha = 'padrao';
  }

  // Override do chamador: SÓ SOBE (expressa < padrao < reforcada).
  const ordem = { expressa: 0, padrao: 1, reforcada: 2 };
  if (sinais.override && ordem[sinais.override] !== undefined && ordem[sinais.override] > ordem[trilha]) {
    trilha = sinais.override;
  }

  return { trilha, sinais };
}

// ── DOSAGEM DAS ALAVANCAS (Herbert 2026-08-12): rotear a alavanca à CLASSE, não ligar por default ──
// O A/B em escala mostrou: micro-foco+âncora ligados sempre = mesmo placar do baseline num lote de
// APARATO, e custam chamadas. A dose certa é por classe. A âncora AUTO-DOSA (retrieval barato, injeta
// só score≥limiar), logo corre sempre. O micro-foco é a alavanca CARA (1 chamada extra) — dosa-se por
// COMPLEXIDADE, o sinal pré-geração do que arrisca saturar o um-jato. Ancorado no MEDIDO: os fechos do
// micro-foco (/699 sklearn, /328 queue, /833 statistics) eram algorítmicos/numéricos; o que não ajudou
// (I/O: os/shutil/csv/base64) não tem lib pesada. NORTE (a refinar): a dose principled é REATIVA —
// medir a saturação do reasoning na 1ª geração e escalar só na saturação observada (a V4 da triagem).
const LIB_PESADA = /\b(sklearn|scikit|scipy|statsmodels|statistics|numpy|networkx|sympy|queue|heapq|itertools|cv2|torch|tensorflow)\b/i;
function dosagem(task, opts = {}) {
  const t = String(task || '');
  const base = triagem(t, opts);
  const sig = (t.match(/def\s+\w+\s*\(([^)]*)\)/) || [, ''])[1];
  const nParams = sig.split(',').map((s) => s.trim()).filter(Boolean).length;
  const libPesada = LIB_PESADA.test(t);
  const complexo = libPesada || nParams >= 4;
  return {
    // micro-foco: só onde a tarefa é complexa o suficiente para arriscar saturar o um-jato
    microfoco: complexo,
    // âncora: sempre consulta a base (retrieval barato, auto-dosa injetando só o análogo forte)
    ancora: true,
    trilha: base.trilha,
    sinais: { ...base.sinais, lib_pesada: libPesada, n_params: nParams, complexo },
  };
}

module.exports = { triagem, dosagem, RISCO, LIB_PESADA };
