-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- Mukta Zero — Fase 3 studio/site-gen: artefatos gerados (HTML/site), RLS por owner.
-- A edge fn generate-site insere com user_id EXPLÍCITO (o sql do mukta-edge não tem auth.uid()).
-- O default auth.uid() serve p/ inserts diretos via PostgREST (front). RLS garante isolamento.

create table if not exists public.mz_artifacts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id      uuid references public.mz_projects(id) on delete set null,
  conversation_id uuid references public.mz_conversations(id) on delete set null,
  kind            text not null default 'site',
  title           text,
  content         text not null,
  model           text,
  created_at      timestamptz not null default now()
);
alter table public.mz_artifacts enable row level security;
drop policy if exists artifacts_own on public.mz_artifacts;
create policy artifacts_own on public.mz_artifacts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant insert, select, update, delete on public.mz_artifacts to authenticated;

notify pgrst, 'reload schema';
