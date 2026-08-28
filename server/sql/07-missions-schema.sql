-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- Mukta Zero — Fase 4 AMC/missões. Uma missão = objetivo multi-step que produz DELIVERABLES
-- (cada step gera um mz_artifacts). RLS por owner. A edge fn run-mission insere com user_id EXPLÍCITO.

create table if not exists public.mz_missions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal        text not null,
  status      text not null default 'running',   -- running | done | partial | failed
  steps_total int not null default 0,
  steps_done  int not null default 0,
  created_at  timestamptz not null default now()
);
create table if not exists public.mz_mission_steps (
  id          uuid primary key default gen_random_uuid(),
  mission_id  uuid not null references public.mz_missions(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  idx         int not null,
  title       text,
  spec        text,
  status      text not null default 'done',
  artifact_id uuid references public.mz_artifacts(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.mz_missions      enable row level security;
alter table public.mz_mission_steps enable row level security;
drop policy if exists missions_own on public.mz_missions;
drop policy if exists mission_steps_own on public.mz_mission_steps;
create policy missions_own on public.mz_missions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy mission_steps_own on public.mz_mission_steps for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant insert, select, update, delete on public.mz_missions, public.mz_mission_steps to authenticated;

notify pgrst, 'reload schema';
