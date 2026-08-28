// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz falhas — o LOG DE FALHAS dos runs, no terminal.
 *
 * Espelha a aba Falhas de `app.example.com` (#/obs → Falhas).
 *
 * ⚠️ CORREÇÃO (FB11, 2026-08-09): a primeira versão filtrava
 * `error_code not null OR dod_passed = false` — e **excluía `status='failed'`**,
 * que é o campo canônico de falha. Resultado medido: o comando dizia "nenhuma
 * falha registrada" enquanto o banco tinha 19 runs falhados. Um filtro de
 * falhas que não olha o campo de falha.
 *
 * O filtro veio da especificação do MZ-Front e eu o espelhei fielmente; a tela
 * deles tinha o mesmo buraco. Espelhar fielmente uma especificação errada
 * produz dois erros iguais e a impressão de concordância — que é pior do que um
 * erro só, porque parece confirmação.
 *
 * Agora a fonte é a RPC `public.mz_falhas(p_limit)`, que (a) inclui
 * `status='failed'`, (b) junta o run ao `mz_jobs` por `job_id` e devolve
 * `etapas` = `[{phase,label,at}]` — a trilha de cada etapa com timestamp — e
 * `error_detail` com o gate nomeado, e (c) deriva um `error_code` normalizado.
 *
 * A distinção que este comando existe para carregar CONTINUA valendo, e agora
 * com número: `mz_runs_cobertura(p_days)` diz quanto do acervo tem cada campo,
 * então "nenhuma falha" e "não instrumentado" nunca se confundem.
 *
 * Acesso: JWT do usuário — RLS decide o que ele enxerga. Nunca service-role.
 */

/** Campos que o comando exibe — a RPC devolve mais; isto é o contrato de tela. */
export const CAMPOS = [
  "run_id", "started_at", "run_kind", "status", "error_code", "error_detail",
  "model_slug", "step_id", "phase_id", "attempt", "dod", "dod_passed",
  "job_id", "ultima_fase", "etapas", "persona_slug", "charter_version", "idade_h",
];

/**
 * Lista as falhas pela RPC canônica. Nunca lança — devolve forma estruturada
 * para o comando decidir texto e exit code.
 */
export async function listarFalhas(client, { runId = null, limit = 20 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const { data, error } = await client.rpc("mz_falhas", { p_limit: runId ? 200 : n });
  if (error) {
    // 401 (credencial) e 42501 (permissão) são causas DIFERENTES e confundi-las
    // custa uma tarde — aviso que veio do próprio MZ-Front no canal FB#.
    const dica =
      /jwt|token|credential/i.test(error.message) ? "credencial inválida ou expirada (não é permissão) — rode `mz auth`"
        : error.code === "42501" ? "permissão negada pela RLS (a credencial é válida) — sua conta não enxerga estes runs"
          : /schema cache|does not exist/i.test(error.message) ? "a RPC `mz_falhas` não existe nesta instância — instância desatualizada?"
            : error.message;
    return { ok: false, erro: dica, detalhe: error.details || error.hint || null };
  }
  let falhas = Array.isArray(data) ? data : [];
  if (runId) falhas = falhas.filter((f) => String(f.run_id).startsWith(runId));
  return { ok: true, falhas: falhas.slice(0, n), total: falhas.length };
}

/**
 * Cobertura da instrumentação — para o comando declarar o que NÃO sabe.
 * Sem isto, uma lista vazia seria lida como "não houve falhas", que é uma
 * afirmação de ausência que ninguém pode fazer sem medir.
 */
export async function cobertura(client, { dias = 30 } = {}) {
  const { data, error } = await client.rpc("mz_runs_cobertura", { p_days: dias });
  if (error) return null;
  return Array.isArray(data) ? data[0] : data;
}

/** Uma falha em texto legível — campo ausente vira lacuna explícita, nunca "". */
export function formatarFalha(f) {
  const v = (x) => (x === null || x === undefined || x === "" ? "—" : String(x));
  const quando = String(f.started_at || "").replace("T", " ").slice(0, 19);
  const codigo = f.error_code || (f.status === "failed" ? "status=failed" : f.dod_passed === false ? "DoD reprovado" : "?");
  // `idade_h` ao lado da data: a lista ordena pela DESCOBERTA, então um job
  // pendurado há 24 dias aparece no topo como se tivesse acabado de acontecer.
  // Mostrar só um dos eixos seria meia-verdade — a leitura honesta é
  // "descoberto agora, pendurado há N dias".
  const idade = f.idade_h != null && Number(f.idade_h) >= 24 ? `  · pendurado ${Math.round(Number(f.idade_h) / 24)}d` : "";
  const linhas = [
    `${quando}  [${codigo}]  run ${v(f.run_id).slice(0, 8)}  ·  ${v(f.run_kind)}${idade}`,
  ];
  if (f.error_detail) linhas.push(`  motivo:   ${String(f.error_detail).slice(0, 300)}`);
  if (f.step_id || f.phase_id || f.attempt != null) {
    linhas.push(`  passo:    ${v(f.step_id)}${f.phase_id ? ` · fase ${f.phase_id}` : ""}${f.attempt != null ? ` · tentativa ${f.attempt}` : ""}`);
  }
  if (f.dod) linhas.push(`  dod:      ${v(f.dod)}  → ${f.dod_passed === false ? "REPROVOU" : f.dod_passed === true ? "passou" : "não avaliado"}`);
  linhas.push(`  modelo:   ${v(f.model_slug)}${f.persona_slug ? `  ·  persona ${f.persona_slug}${f.charter_version ? ` v${f.charter_version}` : ""}` : ""}`);
  // A trilha de etapas é o que responde "onde exatamente parou" — o pedido
  // original do Herbert. Só aparece quando o run passou pelo caminho async.
  const et = Array.isArray(f.etapas) ? f.etapas : [];
  if (et.length) {
    linhas.push(`  trilha:   ${et.map((e) => `${e.label || e.phase}${e.at ? ` (${String(e.at).slice(11, 19)})` : ""}`).join(" → ")}`);
  } else if (f.ultima_fase) {
    linhas.push(`  trilha:   parou em ${f.ultima_fase}`);
  }
  return linhas.join("\n");
}

/** Texto da cobertura — o que o acervo permite (e não permite) afirmar. */
export function formatarCobertura(c, { dias = 30 } = {}) {
  if (!c) return "(não consegui medir a cobertura da instrumentação)";
  const pct = (n) => (c.runs ? `${Math.round((n / c.runs) * 100)}%` : "?");
  return [
    `cobertura da instrumentação nos últimos ${dias} dias (${c.runs} runs):`,
    `  status='failed' .... ${c.status_failed} (${pct(c.status_failed)})   ← o campo canônico de falha`,
    `  error_code ......... ${c.com_error_code} (${pct(c.com_error_code)})`,
    `  dod/dod_passed ..... ${c.com_dod} (${pct(c.com_dod)})`,
    `  step_id ............ ${c.com_step_id} (${pct(c.com_step_id)})`,
    `  trilha de etapas ... ${c.com_etapas} (${pct(c.com_etapas)})   ← só o caminho async deixa trilha`,
  ].join("\n");
}
