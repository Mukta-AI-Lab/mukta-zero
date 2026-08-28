-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- mz_jobs — jobs assíncronos (job_id + poll) p/ tarefas longas que estouram o Cloudflare-100s.
-- Processadas via fire-and-forget no edge mz-async (o runtime Deno da .107 mantém a promise após o Response).
create table if not exists public.mz_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  kind text not null default 'chat',
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  input jsonb, result jsonb, error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists mz_jobs_user_idx on public.mz_jobs(user_id, created_at desc);
