-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- Mukta Zero — configuração do Storage da instância (Fase 1b, upload de arquivos)
-- Aplicado na instância mukta-zero (<HOST>) via psql no container mz-db.
-- REPRODUZÍVEL: reflete o estado final que passou nos gates de upload/download/isolamento.
--
-- CONTEXTO (por que cada passo existe):
-- O stack Supabase v2 desta instância veio SEM os grants/memberships padrão que o storage-api
-- assume. O storage-api conecta como supabase_storage_admin e, por requisição, faz
-- `SET LOCAL ROLE authenticated` + seta request.jwt.claims. Sem os itens abaixo, o upload
-- falhava com "new row violates row-level security policy" (mensagem enganosa — o erro real
-- era 42501 em guc.c: supabase_storage_admin não podia trocar de role).

-- 1) Bucket privado (idempotente)
insert into storage.buckets (id, name, public)
values ('mz-uploads', 'mz-uploads', false)
on conflict (id) do nothing;

-- 2) MEMBERSHIP: o storage-admin precisa ser MEMBRO de authenticated/anon/service_role
--    p/ poder `SET LOCAL ROLE authenticated` (era a causa-raiz do 42501).
grant anon, authenticated, service_role to supabase_storage_admin;

-- 3) GRANTS de tabela p/ os roles da API (o effective role no INSERT vira authenticated)
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects  to authenticated, service_role;
grant select, insert, update, delete on storage.prefixes to authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- 4) USAGE no schema auth p/ as policies chamarem auth.uid()/auth.role()
grant usage on schema auth to supabase_storage_admin, authenticated, anon, service_role;
grant execute on function auth.uid()  to supabase_storage_admin, authenticated, anon, service_role;
grant execute on function auth.role() to supabase_storage_admin, authenticated, anon, service_role;

-- 5) POLICIES em storage.objects — owner-scoped (isolamento multi-tenant no read/delete)
drop policy if exists mz_up_ins on storage.objects;
drop policy if exists mz_up_sel on storage.objects;
drop policy if exists mz_up_del on storage.objects;
create policy mz_up_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'mz-uploads');
create policy mz_up_sel on storage.objects for select to authenticated
  using (bucket_id = 'mz-uploads' and owner = auth.uid());
create policy mz_up_del on storage.objects for delete to authenticated
  using (bucket_id = 'mz-uploads' and owner = auth.uid());

-- 6) POLICIES em storage.prefixes — a trigger objects_insert_create_prefix escreve aqui;
--    sem policy (RLS on, zero policy) o INSERT em objects era bloqueado no trigger.
drop policy if exists mz_pfx_ins on storage.prefixes;
drop policy if exists mz_pfx_sel on storage.prefixes;
create policy mz_pfx_ins on storage.prefixes for insert to authenticated
  with check (bucket_id = 'mz-uploads');
create policy mz_pfx_sel on storage.prefixes for select to authenticated
  using (bucket_id = 'mz-uploads');
