// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// formal-reasoning-auditor.ts — SKILL de auditoria de raciocínio FORMAL reutilizável (qualquer modelo, via `dispatch`).
// Classifica: ESTRUTURA (prova direta/absurdo/indução/analogia/asserção-sem-suporte), SILOGISMO (válido/inválido + erro),
// FALÁCIAS (taxonomia canônica), FIRMEZA das premissas (axioma firme vs tese mal-estruturada). Testado 6/6 em casos rotulados.
export const FORMAL_AUDITOR_SYS = `Você é AUDITOR DE RACIOCÍNIO FORMAL. Analise o argumento e classifique com RIGOR lógico.
ESTRUTURA (uma): "prova_direta" (premissas→conclusão dedutiva) · "prova_por_absurdo" (nega a tese e deriva contradição) · "inducao" (generaliza de casos/estatística) · "analogia" · "assercao_sem_suporte".
SILOGISMO: se for silogismo categórico, diga se é VÁLIDO ou INVÁLIDO e, se inválido, o ERRO (ex.: "termo médio não distribuído", "maior/menor ilícito", "quatro termos").
FALÁCIAS (liste as presentes, nome canônico): afirmacao_do_consequente, negacao_do_antecedente, circularidade/peticao_de_principio, falso_dilema, apelo_a_popularidade, apelo_a_autoridade, apelo_a_emocao, generalizacao_apressada, espantalho, ad_hominem, equivocacao, correlacao_nao_causa, non_sequitur.
FIRMEZA das premissas: "firme" (axioma/lei estabelecida) · "moderada" · "fraca" (tese mal-estruturada/sem suporte).
SOMENTE JSON {"estrutura":"..","silogismo":{"eh_silogismo":bool,"valido":bool,"erro":".."},"falacias":["nome: por quê"],"firmeza_premissas":"firme|moderada|fraca","veredito":"sólido|falho"}.`;

export interface FormalAudit { estrutura: string; silogismo: { eh_silogismo: boolean; valido: boolean; erro?: string }; falacias: string[]; firmeza_premissas: "firme" | "moderada" | "fraca"; veredito: "sólido" | "falho" }

/** dispatch(sys,user) → texto JSON cru. Reutiliza o dispatcher da instância (DeepSeek-V4-Pro) ou qualquer LLM. */
export async function formalAudit(dispatch: (sys: string, user: string) => Promise<string | null>, argument: string): Promise<FormalAudit | null> {
  const raw = await dispatch(FORMAL_AUDITOR_SYS, `ARGUMENTO:\n${argument}`);
  if (!raw) return null;
  const c = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(c); } catch { const m = c.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} } return null; }
}
