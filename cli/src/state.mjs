// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// mukta-zero-states.mjs — Motor de estados de execução especialistas (Mukta Zero)
// Módulo ESM puro, sem dependências externas, sem fs, rede ou Date.

/**
 * Cria um objeto de estado normalizado.
 * @param {Object} params
 * @param {string} params.name - Nome do estado (obrigatório)
 * @param {string} [params.description=""] - Descrição
 * @param {string} params.persona - Persona da tarefa (obrigatória)
 * @param {string[]} [params.entryKeywords=[]] - Palavras-chave de entrada
 * @param {string} [params.createdBy="user"] - Quem criou
 * @returns {Object} Estado normalizado
 */
export function makeState({ name, description = "", persona, entryKeywords = [], createdBy = "user" }) {
  // Validação: name obrigatório
  if (!name || (typeof name === "string" && name.trim() === "")) {
    throw new Error("name obrigatório");
  }

  // Validação: persona obrigatória
  if (!persona || (typeof persona === "string" && persona.trim() === "")) {
    throw new Error("persona obrigatória");
  }

  // Transforma name em slug: minúsculas, espaços → "_", remove tudo que não casa [a-z0-9_-]
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");

  // entryKeywords: mapeia para strings minúsculas trim, descarta vazias
  const cleanedKeywords = entryKeywords
    .map(kw => (typeof kw === "string" ? kw.toLowerCase().trim() : ""))
    .filter(kw => kw !== "");

  return {
    name: slug,
    description,
    persona,
    entryKeywords: cleanedKeywords,
    created_by: createdBy,
    status: "pending",
    created_at: null  // quem persiste carimba
  };
}

/**
 * Valida um estado conforme regras de governança.
 * @param {Object} state - Estado a validar
 * @returns {{ ok: boolean, reason: string }}
 */
export function validateState(state) {
  // Verifica existência e nome
  if (!state || !state.name || !/^[a-z0-9_-]{2,40}$/.test(state.name)) {
    return { ok: false, reason: "name inválido" };
  }

  // Verifica persona
  if (!state.persona || !state.persona.trim()) {
    return { ok: false, reason: "persona vazia" };
  }

  // Verifica tentativas de burlar guardas na persona (case-insensitive)
  const personaLower = state.persona.toLowerCase();
  const bypassPatterns = [
    /ignore\s+(as\s+)?guardas/i,
    /ignore\s+.{0,20}guard/i,
    /desabilit\w*\s+.{0,20}(guarda|seguran)/i,
    /revele?\s+.{0,20}(segredo|senha|token|credencial)/i,
    /sem\s+restri/i,
    /\bbypass\b/i,
    /disable\s+.{0,20}(guard|safety)/i
  ];

  for (const pattern of bypassPatterns) {
    if (pattern.test(personaLower)) {
      return { ok: false, reason: "persona tenta burlar guardas" };
    }
  }

  return { ok: true, reason: "ok" };
}

/**
 * Seleciona o estado aprovado com mais entryKeywords presentes na task.
 * @param {string} task - Texto da tarefa
 * @param {Object[]} states - Array de estados
 * @returns {Object|null} Estado selecionado ou null
 */
export function selectState(task, states) {
  // Trata task vazio/não-string
  if (typeof task !== "string" || task.trim() === "") {
    return null;
  }

  const taskLower = task.toLowerCase();

  let bestState = null;
  let bestScore = 0;

  for (const state of states) {
    // Ignora estados sem status "approved"
    if (!state || state.status !== "approved") {
      continue;
    }

    // Conta quantas entryKeywords (case-insensitive) estão presentes na task
    const keywords = state.entryKeywords || [];
    let score = 0;
    for (const kw of keywords) {
      if (taskLower.includes(kw.toLowerCase())) {
        score++;
      }
    }

    // Só considera se tiver ao menos 1 keyword
    if (score > 0 && score > bestScore) {
      bestScore = score;
      bestState = state;
    }
    // Em empate, mantém o primeiro (não atualiza)
  }

  return bestState;
}
