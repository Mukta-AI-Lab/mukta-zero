-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- Mukta Zero — Observabilidade user-facing (6b/6c). RPCs SECURITY DEFINER que expõem
-- APENAS métricas (sem PII: nada de user_query/generated_response/response_text/thinking_text),
-- escopadas por company via auth.uid(). O front chama estas RPCs (NÃO a tabela) — assim
-- agent_execution_logs não precisa de RLS (o INSERT do handler mukta-edge não é afetado).

create or replace function public.get_my_agent_logs(p_limit int default 50, p_offset int default 0)
returns table(id uuid, created_at timestamptz, tokens_used int, completion_status text, decision_trace jsonb, conversation_id uuid)
language sql stable security definer set search_path = public
as $fn$
  select id, created_at, tokens_used, completion_status, decision_trace, conversation_id
  from public.agent_execution_logs
  where company_id in (select company_id from public.user_company_memberships where user_id = auth.uid())
  order by created_at desc
  limit least(coalesce(p_limit, 50), 200) offset greatest(coalesce(p_offset, 0), 0);
$fn$;
grant execute on function public.get_my_agent_logs(int, int) to authenticated;

create or replace function public.get_my_usage_summary()
returns table(runs bigint, total_tokens bigint, avg_latency_ms numeric)
language sql stable security definer set search_path = public
as $fn$
  select count(*)::bigint, coalesce(sum(tokens_used), 0)::bigint,
         round(avg(nullif(decision_trace->>'latency_ms', '')::numeric), 0)
  from public.agent_execution_logs
  where company_id in (select company_id from public.user_company_memberships where user_id = auth.uid());
$fn$;
grant execute on function public.get_my_usage_summary() to authenticated;

notify pgrst, 'reload schema';
