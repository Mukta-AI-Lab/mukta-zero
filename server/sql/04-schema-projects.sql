-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- Mukta Zero — Fase 1c: PROJETOS + arquivos de projeto (superfície do app, RLS por usuário).
-- Aplicado na instância mukta-zero via psql. Espelha o padrão de mz_conversations/mz_messages (1a):
-- user_id NOT NULL DEFAULT auth.uid(); policy ALL owner; grants CRUD a authenticated.

create table if not exists public.mz_projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  description text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.mz_projects enable row level security;
drop policy if exists proj_own on public.mz_projects;
create policy proj_own on public.mz_projects for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant insert, select, update, delete on public.mz_projects to authenticated;

create table if not exists public.mz_project_files (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id   uuid not null references public.mz_projects(id) on delete cascade,
  file_name    text not null,
  storage_path text not null,       -- caminho no bucket mz-uploads
  created_at   timestamptz not null default now()
);
alter table public.mz_project_files enable row level security;
drop policy if exists pf_own on public.mz_project_files;
create policy pf_own on public.mz_project_files for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant insert, select, update, delete on public.mz_project_files to authenticated;

-- runs (conversas) podem pertencer a um projeto
alter table public.mz_conversations add column if not exists project_id uuid references public.mz_projects(id) on delete set null;

notify pgrst, 'reload schema';
