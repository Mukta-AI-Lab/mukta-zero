// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli ui/modes — os MODOS DE EXECUÇÃO da janela e o MODELO DE
 * ACESSO A ARQUIVOS que cada um concede.
 *
 * O modo é a única coisa que decide o que o agente pode tocar no disco. Ele é
 * visível o tempo todo na barra de status e cicla com Shift+Tab — a mesma
 * affordance que Claude Code/Codex usam, porque o custo de errar o modo é alto
 * e ele precisa estar SEMPRE à vista, não escondido numa flag.
 *
 * Política (fail-closed): quem não declara `write` não escreve, quem não declara
 * `exec` não roda comando. O gate offline (vendor/cyber-gate.mjs) roda DEPOIS
 * disso em qualquer caminho que gere código — modo não burla gate.
 */

/**
 * @typedef {object} Mode
 * @property {string} id
 * @property {string} label rótulo curto p/ a barra de status
 * @property {string} hint  explicação de uma linha
 * @property {boolean} read  pode LER arquivos do workspace
 * @property {boolean} write pode ESCREVER arquivos
 * @property {boolean} exec  pode RODAR comandos (testes/build)
 * @property {boolean} approve exige aprovação humana por escrita
 * @property {string} engine rota de execução (ver ui/engine.mjs)
 */

/** @type {Mode[]} */
export const MODES = [
  {
    id: "conversa",
    label: "conversa",
    hint: "só leitura — responde, lê os arquivos anexados, NÃO escreve nada",
    read: true,
    write: false,
    exec: false,
    approve: false,
    engine: "chat",
  },
  {
    id: "plano",
    label: "plano",
    hint: "decompõe o objetivo em passos e mostra o plano — não executa nada",
    read: true,
    write: false,
    exec: false,
    approve: false,
    engine: "plan",
  },
  {
    id: "agente",
    label: "agente",
    hint: "edita arquivos, mas PEDE APROVAÇÃO a cada escrita (diff antes de aplicar)",
    read: true,
    write: true,
    exec: false,
    approve: true,
    engine: "agent",
  },
  {
    id: "auto",
    label: "auto",
    hint: "edita e roda testes sem perguntar — o cyber-gate segue valendo",
    read: true,
    write: true,
    exec: true,
    approve: false,
    engine: "agent",
  },
];

export const DEFAULT_MODE = "conversa";

export function getMode(id) {
  return MODES.find((m) => m.id === id) || MODES[0];
}

/** Próximo modo no ciclo (Shift+Tab). */
export function nextMode(id) {
  const i = MODES.findIndex((m) => m.id === id);
  return MODES[(i + 1) % MODES.length].id;
}

/** Modo anterior (Shift+Tab com shift invertido / Alt+Shift+Tab). */
export function prevMode(id) {
  const i = MODES.findIndex((m) => m.id === id);
  return MODES[(i - 1 + MODES.length) % MODES.length].id;
}

/**
 * Cor da barra de status por modo — sinal periférico. Verde/neutro p/ modos que
 * não escrevem, âmbar p/ o que escreve com aprovação, vermelho p/ o autônomo.
 */
export function modeColorCode(id) {
  return { conversa: 37, plano: 39, agente: 178, auto: 167 }[id] ?? 245;
}

/* ───────────────── modelo de acesso a arquivos ───────────────── */

/** Arquivos que NUNCA entram no contexto nem são escritos, em nenhum modo. */
export const DENY_PATTERNS = [
  /(^|[\\/])\.env(\.|$)/i,
  /(^|[\\/])\.git[\\/]/,
  /(^|[\\/])node_modules[\\/]/,
  /(^|[\\/])(id_rsa|id_ed25519|\.pem|\.pfx|\.p12)$/i,
  /(^|[\\/])\.mukta[\\/]sessions[\\/]/,
  /(^|[\\/])(session|providers|target)\.json$/i,
  /(^|[\\/])\.aws[\\/]/,
  /(^|[\\/])\.ssh[\\/]/,
];

/** true se o caminho é segredo/ruído — bloqueado para leitura E escrita. */
export function isDenied(relPath) {
  const p = String(relPath).replace(/\\/g, "/");
  return DENY_PATTERNS.some((re) => re.test(p) || re.test(String(relPath)));
}

/**
 * Decide se uma operação é permitida no modo corrente.
 * @returns {{allowed: boolean, needsApproval: boolean, reason: string}}
 */
export function checkAccess(modeId, op, relPath = "") {
  const m = getMode(modeId);
  if (relPath && isDenied(relPath)) {
    return { allowed: false, needsApproval: false, reason: "caminho protegido (segredo/infra) — bloqueado em todos os modos" };
  }
  if (op === "read") {
    return m.read
      ? { allowed: true, needsApproval: false, reason: "" }
      : { allowed: false, needsApproval: false, reason: `modo ${m.label} não lê arquivos` };
  }
  if (op === "write") {
    if (!m.write) return { allowed: false, needsApproval: false, reason: `modo ${m.label} é somente-leitura — troque com Shift+Tab` };
    return { allowed: true, needsApproval: m.approve, reason: "" };
  }
  if (op === "exec") {
    return m.exec
      ? { allowed: true, needsApproval: false, reason: "" }
      : { allowed: false, needsApproval: false, reason: `modo ${m.label} não roda comandos — use o modo auto` };
  }
  return { allowed: false, needsApproval: false, reason: `operação desconhecida: ${op}` };
}
