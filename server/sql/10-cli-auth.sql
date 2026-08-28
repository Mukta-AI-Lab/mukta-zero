-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
create table if not exists public.cli_auth_requests (
  device_code text primary key,
  user_code text unique not null,
  status text not null default 'pending' check (status in ('pending','approved','denied','consumed')),
  user_id uuid,
  access_token text,
  client_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  poll_count int not null default 0
);
create index if not exists cli_auth_usercode_idx on public.cli_auth_requests(user_code);
create index if not exists cli_auth_expires_idx on public.cli_auth_requests(expires_at);
select 'cli_auth_requests criada' as ok, count(*) from public.cli_auth_requests;
