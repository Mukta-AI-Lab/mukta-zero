-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- Mukta Zero — Fase 8a: SPINE de dados da visibilidade multi-agente + liveness (control tower)
-- + subject do auditor. Uma linha = um "run" de agente (turno/step/missão). RLS por owner.
-- Aplicado na instância via psql (instância INDEPENDENTE; a regra MCP-only é da prod).

create table if not exists public.mz_agent_runs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id       uuid,
  run_kind         text not null default 'mission_step',   -- chat_turn|mission|mission_step|site_gen|amc
  role             text,        -- planner|executor|reviewer|cyber|synthesizer
  kind             text,        -- plan|build|review|replan|verify|handoff
  status           text not null default 'running',        -- running|done|failed|partial|stale|killed
  mission_id       uuid,
  step_id          uuid,
  phase_id         text,
  team_id          uuid,
  conversation_id  uuid,
  member_id        uuid,
  attempt          int not null default 1,
  started_at       timestamptz not null default now(),
  heartbeat_at     timestamptz,
  ended_at         timestamptz,
  model_slug       text,
  tokens_used      int,
  latency_ms       int,
  cost_brl         numeric,
  execution_log_id uuid,        -- soft-link p/ agent_execution_logs (sem FK)
  dod              text,
  dod_passed       boolean,
  input_summary    text,        -- SÓ resumo (sem PII cru)
  output_summary   text,
  artifact_id      uuid,
  error_code       text,
  created_at       timestamptz not null default now()
);
create unique index if not exists mz_agent_runs_step_role_attempt
  on public.mz_agent_runs(step_id, role, attempt) where step_id is not null;
create index if not exists mz_agent_runs_mission on public.mz_agent_runs(mission_id, created_at desc);
create index if not exists mz_agent_runs_liveness on public.mz_agent_runs(status, heartbeat_at);
alter table public.mz_agent_runs enable row level security;
drop policy if exists agent_runs_own on public.mz_agent_runs;
create policy agent_runs_own on public.mz_agent_runs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant insert, select, update, delete on public.mz_agent_runs to authenticated;

-- ciclo de vida + kill-switch nas missões
alter table public.mz_missions add column if not exists conversation_id uuid;
alter table public.mz_missions add column if not exists team_id uuid;
alter table public.mz_missions add column if not exists started_at timestamptz;
alter table public.mz_missions add column if not exists heartbeat_at timestamptz;
alter table public.mz_missions add column if not exists ended_at timestamptz;
alter table public.mz_missions add column if not exists kill_requested_at timestamptz;
alter table public.mz_missions add column if not exists kill_requested_by uuid;
alter table public.mz_missions add column if not exists killed_at timestamptz;

-- vínculos nos steps
alter table public.mz_mission_steps add column if not exists phase_id text;
alter table public.mz_mission_steps add column if not exists agent_run_id uuid;
alter table public.mz_mission_steps add column if not exists role text;
alter table public.mz_mission_steps add column if not exists depends_on jsonb not null default '[]'::jsonb;
alter table public.mz_mission_steps add column if not exists team_id uuid;

notify pgrst, 'reload schema';
