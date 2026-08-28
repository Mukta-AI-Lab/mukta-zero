-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
create table if not exists public.mz_point_pricing (
  service_key text primary key,
  points_per_1k_in numeric, points_per_1k_out numeric, points_per_call numeric,
  note text, updated_at timestamptz not null default now()
);
insert into public.mz_point_pricing (service_key, points_per_1k_in, points_per_1k_out, note) values
  ('deepseek-ai/DeepSeek-V4-Pro', 0.583, 2.376, 'nebius $0.27/$1.10 per 1M · USD/BRL 5.4 · margem 75%'),
  ('google/gemma-4-31B-it', 0.108, 0.432, 'deepinfra $0.05/$0.20 per 1M · margem 75%')
on conflict (service_key) do update set points_per_1k_in=excluded.points_per_1k_in, points_per_1k_out=excluded.points_per_1k_out, note=excluded.note, updated_at=now();
insert into public.mz_point_pricing (service_key, points_per_call, note) values
  ('tool:internet_search', 1, 'fixo Herbert · margem ~96%'),
  ('tool:scrape', 2, 'fixo Herbert · margem ~84%')
on conflict (service_key) do update set points_per_call=excluded.points_per_call, note=excluded.note, updated_at=now();
select service_key, coalesce(points_per_1k_in::text,'-') as in_1k, coalesce(points_per_1k_out::text,'-') as out_1k, coalesce(points_per_call::text,'-') as per_call from public.mz_point_pricing order by service_key;
