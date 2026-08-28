-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- Mukta Zero — Fase 8e: RPCs do CONTROL TOWER (SECURITY DEFINER, PII-safe, escopo por owner).
-- "Rodando agora" = missões running com heartbeat fresco (liveness). Consumo = agregado de mz_agent_runs.
-- Só MÉTRICAS (sem user_query/response/content). Kill/sweep respeitam RLS (só o próprio owner).

create or replace function public.mz_ct_active_runs()
returns table(mission_id uuid, goal text, status text, steps_done int, steps_total int, started_at timestamptz, uptime_s int, heartbeat_age_s int)
language sql stable security definer set search_path = public as $fn$
  select id, left(goal, 80), status, steps_done, steps_total, started_at,
         extract(epoch from (now() - started_at))::int,
         extract(epoch from (now() - coalesce(heartbeat_at, started_at)))::int
  from public.mz_missions
  where user_id = auth.uid() and status = 'running'
    and coalesce(heartbeat_at, started_at) > now() - interval '90 seconds'
  order by started_at desc;
$fn$;
grant execute on function public.mz_ct_active_runs() to authenticated;

create or replace function public.mz_ct_consumption_by_agent(p_window text default '24h')
returns table(agent text, model_slug text, runs bigint, tokens bigint, avg_latency_ms numeric)
language sql stable security definer set search_path = public as $fn$
  select coalesce(role, '?'), coalesce(model_slug, '?'), count(*)::bigint,
         coalesce(sum(tokens_used), 0)::bigint, round(avg(latency_ms), 0)
  from public.mz_agent_runs
  where user_id = auth.uid()
    and created_at > now() - (case when p_window = '7d' then interval '7 days' else interval '24 hours' end)
  group by role, model_slug
  order by count(*) desc;
$fn$;
grant execute on function public.mz_ct_consumption_by_agent(text) to authenticated;

create or replace function public.mz_ct_fleet_health()
returns table(active_missions bigint, runs_24h bigint, tokens_24h bigint, error_rate numeric)
language sql stable security definer set search_path = public as $fn$
  select
    (select count(*) from public.mz_missions where user_id = auth.uid() and status = 'running'
       and coalesce(heartbeat_at, started_at) > now() - interval '90 seconds')::bigint,
    (select count(*) from public.mz_agent_runs where user_id = auth.uid() and created_at > now() - interval '24 hours')::bigint,
    (select coalesce(sum(tokens_used), 0) from public.mz_agent_runs where user_id = auth.uid() and created_at > now() - interval '24 hours')::bigint,
    (select round(100.0 * count(*) filter (where status = 'failed') / greatest(count(*), 1), 1)
       from public.mz_agent_runs where user_id = auth.uid() and created_at > now() - interval '24 hours');
$fn$;
grant execute on function public.mz_ct_fleet_health() to authenticated;

-- ceifa zumbis: missões 'running' sem heartbeat fresco → 'stale' (crash/timeout Kong/rede)
create or replace function public.mz_sweep_stale_runs()
returns int language sql security definer set search_path = public as $fn$
  with upd as (
    update public.mz_missions set status = 'stale', ended_at = coalesce(heartbeat_at, started_at)
    where user_id = auth.uid() and status = 'running'
      and coalesce(heartbeat_at, started_at) < now() - interval '90 seconds'
    returning 1)
  select count(*)::int from upd;
$fn$;
grant execute on function public.mz_sweep_stale_runs() to authenticated;

-- KILL manual: seta kill_requested_at (o loop respeita no próximo checkpoint). Só o owner, só se running.
create or replace function public.mz_request_kill(p_mission_id uuid)
returns boolean language sql security definer set search_path = public as $fn$
  with upd as (
    update public.mz_missions set kill_requested_at = now(), kill_requested_by = auth.uid()
    where id = p_mission_id and user_id = auth.uid() and status = 'running'
    returning 1)
  select exists (select 1 from upd);
$fn$;
grant execute on function public.mz_request_kill(uuid) to authenticated;

notify pgrst, 'reload schema';
