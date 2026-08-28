-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- schema-conversations.sql — mz_conversations + mz_messages
--
-- ORIGEM (2026-08-25): estas duas tabelas existiam no banco VIVO da instância mas NÃO tinham
-- DDL em lugar nenhum do repositório — só eram referenciadas (artifacts-schema.sql,
-- schema-projects.sql, migrations/20260803170000_mz_conversations_pinned.sql, e o front).
-- Consequência medida: a instância NÃO era reconstruível a partir do git (gap de DR), e
-- ninguém conseguiria auto-hospedar. DDL extraída do banco vivo por pg_dump --schema-only
-- e versionada aqui. Idempotente para poder rodar sobre instância existente.

create table if not exists public.mz_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  project_id  uuid references public.mz_projects(id) on delete set null,
  pinned_at   timestamptz
);

comment on column public.mz_conversations.pinned_at is
  'Quando a conversa foi fixada pelo usuário. NULL = não fixada. Timestamp (não boolean) para que o rail possa ordenar as fixadas por quando foram fixadas.';

create table if not exists public.mz_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.mz_conversations(id) on delete cascade,
  user_id         uuid not null default auth.uid(),
  role            text not null,
  content         text not null,
  created_at      timestamptz not null default now()
);

create index if not exists mz_conversations_pinned_idx
  on public.mz_conversations using btree (user_id, pinned_at desc)
  where (pinned_at is not null);

create index if not exists mz_messages_conv_idx
  on public.mz_messages using btree (conversation_id, created_at);

alter table public.mz_conversations enable row level security;
alter table public.mz_messages      enable row level security;

do $$ begin
  create policy conv_own on public.mz_conversations to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy msg_own on public.mz_messages to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on public.mz_conversations to authenticated;
grant select, insert, update, delete on public.mz_messages      to authenticated;

notify pgrst, 'reload schema';
