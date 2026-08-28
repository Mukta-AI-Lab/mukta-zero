// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * Motor de loop para mz-cli
 * Implementação pura em Node.js ESM sem dependências externas ou child_process
 */

/**
 * Executa um loop assíncrono baseado em iterações e condições de parada.
 * 
 * @param {Object} opts - Configurações do loop
 * @param {Function} opts.iterate - Função assíncrona chamada a cada iteração. Recebe (i).
 * @param {Function} [opts.shouldStop] - Função assíncrona opcional. Recebe (i, lastResult). Retorna true para parar.
 * @param {number} [opts.times=Infinity] - Número de iterações desejadas.
 * @param {number} [opts.intervalMs=0] - Tempo de espera entre iterações em milissegundos.
 * @param {number} [opts.maxIterations=100] - Teto de segurança para evitar loops infinitos.
 * @param {Function} [opts.log] - Função opcional para logging de mensagens.
 * @returns {Promise<{iterations: number, stopped: string, lastResult: any}>}
 */
export async function runLoop(opts) {
  const {
    iterate,
    shouldStop,
    times = Infinity,
    intervalMs = 0,
    maxIterations = 100,
    log
  } = opts;

  let i = 0;
  let lastResult = null;
  let errorCount = 0;
  let stopped = 'unknown';

  const logger = (msg) => {
    if (typeof log === 'function') log(msg);
  };

  while (true) {
    i++;

    try {
      // Executa a iteração atual
      lastResult = await iterate(i);
      
      // Reset contador de erros após sucesso
      errorCount = 0;
    } catch (err) {
      errorCount++;
      logger(`Iteration ${i} failed: ${err.message}`);

      if (errorCount >= 3) {
        stopped = 'error';
        break;
      }
      
      // Se falhou mas não atingiu 3 erros, continua para a próxima iteração
      // O lastResult permanece o do último sucesso
    }

    // Verificação de parada via função customizada
    if (shouldStop && (await shouldStop(i, lastResult)) === true) {
      stopped = 'stop';
      break;
    }

    // Verificação de limite de iterações solicitadas
    if (i >= times) {
      stopped = 'times';
      break;
    }

    // Verificação de teto de segurança
    if (i >= maxIterations) {
      stopped = 'max';
      break;
    }

    // Intervalo entre iterações
    if (intervalMs > 0) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  return {
    iterations: i,
    stopped,
    lastResult
  };
}