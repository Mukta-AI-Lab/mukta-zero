// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview telemetry-privacy-check — a trilha de observabilidade carrega
 * CUSTO E ROTEAMENTO, nunca CONTEÚDO.
 *
 * `agent_execution_logs.decision_trace` é lido por qualquer pessoa da company
 * (a RPC `get_my_agent_logs` filtra por company, não por usuário) e é mostrado
 * na tela de Observabilidade. O prompt do usuário e a resposta do agente NÃO
 * podem entrar aí — o histórico da conversa fica no armazenamento local do
 * próprio usuário.
 *
 * O risco é de deriva: o `trace` é um objeto literal que cresce a cada feature,
 * e um dia alguém acrescenta `prompt` ou `response_text` "para depurar". Este
 * teste lê o CÓDIGO da instância e reprova essa linha antes de ela ser
 * deployada. Também trava a forma do ledger por modelo, de que a tela depende.
 *
 *   node mz-cli/test/telemetry-privacy-check.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, "..", "instance", "run-agent-chat.ts"), "utf8");
const front = readFileSync(path.join(dir, "..", "..", "mz-web", "src", "Observability.jsx"), "utf8");

const log = [];
let fails = 0;
const check = (name, cond, extra = "") => {
  if (cond) log.push(`  ok   ${name}`);
  else { log.push(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`); fails += 1; }
};

/* ── 1. o objeto `trace` não pode ganhar campos de conteúdo ── */
const traceBlock = (src.match(/const trace = \{[\s\S]*?\n {6}\};/) || [""])[0];
check("achei o objeto decision_trace no código", traceBlock.length > 0);

const PROIBIDOS = ["prompt", "response_text", "messages", "content", "answer", "text", "output", "resposta", "user_input"];
const chaves = [...traceBlock.matchAll(/^\s*([a-z_]+):/gim)].map((m) => m[1].toLowerCase());
const vazando = chaves.filter((k) => PROIBIDOS.includes(k));
check(
  `nenhum campo de CONTEÚDO no decision_trace (${chaves.length} campos)`,
  vazando.length === 0,
  `campos proibidos presentes: ${vazando.join(", ")} — o conteúdo da conversa é do usuário, não da telemetria`,
);

/* ── 2. o ledger por modelo grava metadado, não texto ── */
const logCallBlock = (src.match(/const logCall = [\s\S]*?\n {2}\};/) || [""])[0];
check("achei o ledger logCall()", logCallBlock.length > 0);
check(
  "o ledger não recebe nem grava mensagens",
  !/msgs|messages|content|\.text\b/.test(logCallBlock),
  "logCall só pode ver o modelo, o usage e o relógio",
);
for (const campo of ["model", "provider", "purpose", "tokens_in", "tokens_out", "latency_ms", "ok"]) {
  check(`o ledger grava ${campo}`, new RegExp(`${campo}:`).test(logCallBlock));
}
check(
  "o ledger tem teto de tamanho (um run patológico não vira jsonb gigante)",
  /modelCalls\.length > \d+/.test(logCallBlock),
);

/* ── 3. COBERTURA do ledger: quantos pontos de chamada de modelo estão medidos ──
 *
 * A primeira versão deste teste afirmava "todo despacho passa pelo ledger" com
 * base na contagem de `logCall(`. Era falso: eu tinha instrumentado só os dois
 * `dispatch*` e deixado de fora o caminho da RESPOSTA (o mais usado) e o
 * compositor. O resultado apareceu em produção como um run com
 * `model_calls: []` e `tokens_in: 2548` no mesmo trace — a trilha contradizendo
 * a si mesma. Agora o teste MEDE a cobertura em vez de proclamá-la. */
const sitesLlm = (src.match(/await llmFetch\(/g) || []).length;
const sitesLog = (src.match(/logCall\(/g) || []).length - 1; // -1: a definição
const EXCECAO_CONHECIDA = 1; // o compile (§4) roda ANTES do ledger existir — TDZ; ver comentário no código
check(
  `pontos de chamada de modelo instrumentados (${sitesLlm} chamadas de llmFetch, ${sitesLog} registros)`,
  sitesLog >= sitesLlm - EXCECAO_CONHECIDA,
  "há caminho de modelo que não entra no ledger — um run vai mostrar model_calls vazio com tokens > 0",
);
check("o ledger cobre o caminho da RESPOSTA (o mais usado)", /logCall\(m, "resposta"/.test(src) || /logCall\(m, msg\.tool_calls/.test(src));
check("o ledger cobre o compositor (a chamada mais cara)", /logCall\(brainModel, "compositor"/.test(src));
check("o ledger é publicado no decision_trace", /model_calls: modelCalls/.test(src));

/* ── 3b. o elo que faz a trilha CHEGAR à tela ── */
check("run-agent-chat devolve o execution_log_id", /execution_log_id: executionLogId/.test(src));
check("o insert do log usa `returning id`", /returning id/.test(src));

/* ── 4. o front não tem caminho para renderizar conteúdo ── */
const frontCampos = [...front.matchAll(/(?:trace|log|c)\.([a-z_]+)/g)].map((m) => m[1].toLowerCase());
const frontVazando = [...new Set(frontCampos)].filter((k) => ["prompt", "response_text", "answer", "user_input", "resposta"].includes(k));
check("a tela não lê nenhum campo de conteúdo", frontVazando.length === 0, `lê: ${frontVazando.join(", ")}`);
check("a tela declara a política de privacidade ao usuário", /privacy:/.test(front) && /t\.privacy/.test(front));

/* ── 5. o que a tela precisa para o detalhamento existe ── */
check("a tela consome o ledger por modelo", /trace\.model_calls/.test(front));
check("a tela mostra a quebra entrada/saída do run", /trace\.tokens_in/.test(front) && /trace\.tokens_out/.test(front));
check(
  "ausência do ledger vira LACUNA declarada, não zero inventado",
  /perModelMissing/.test(front),
  "backend antigo precisa dizer 'não instrumentado', nunca mostrar 0",
);

console.log("TELEMETRY-PRIVACY-CHECK");
console.log(log.join("\n"));
if (fails) { console.log(`TELEMETRY-PRIVACY-CHECK FAIL: ${fails} de ${log.length}`); process.exit(1); }
console.log(`TELEMETRY-PRIVACY-CHECK PASS: ${log.length} verificações`);
process.exit(0);
