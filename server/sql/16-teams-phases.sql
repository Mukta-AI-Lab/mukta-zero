-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- Mukta Zero — Fase 8d: TIMES / FASES / TROCAS (working teams, workflow phases, handoffs)
-- Catálogos globais (mz_teams, mz_phases) + log append-only de trocas entre times (mz_handoffs)
-- + RPCs owner-scoped PII-safe (get_my_teams, get_my_handoffs, get_my_phase_progress).
-- Aplica no DB da INSTÂNCIA (mz-db) via psql direto — NÃO é a PROD Supabase.

begin;

-- ---------- CATÁLOGO: working teams ----------
create table if not exists mz_teams (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  role_hint  text,                 -- casa com mz_agent_runs.role
  ord        int  not null default 0,
  color      text,                 -- acento p/ a UI
  description text,
  created_at timestamptz not null default now()
);

insert into mz_teams (slug, name, role_hint, ord, color, description) values
  ('planning', 'Planejamento', 'planner',   1, 'indigo', 'Decompõe o objetivo em passos executáveis.'),
  ('build',    'Execução',     'executor',  2, 'teal',   'Produz os deliverables de cada passo.'),
  ('review',   'Revisão',      'reviewer',  3, 'amber',  'Verifica qualidade e conformidade.'),
  ('delivery', 'Entrega',      'delivery',  4, 'emerald','Consolida e entrega o resultado final.')
on conflict (slug) do update set name = excluded.name, role_hint = excluded.role_hint, ord = excluded.ord, color = excluded.color, description = excluded.description;

-- ---------- CATÁLOGO: workflow phases ----------
create table if not exists mz_phases (
  id    uuid primary key default gen_random_uuid(),
  slug  text unique not null,      -- casa com mz_agent_runs.phase_id / mz_mission_steps.phase_id
  name  text not null,
  ord   int  not null default 0
);

insert into mz_phases (slug, name, ord) values
  ('plan',    'Planejar', 1),
  ('build',   'Construir', 2),
  ('review',  'Revisar',  3),
  ('deliver', 'Entregar', 4)
on conflict (slug) do update set name = excluded.name, ord = excluded.ord;

-- ---------- LOG append-only: trocas de informação entre times ----------
create table if not exists mz_handoffs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  mission_id uuid,
  from_team  text not null,        -- slug em mz_teams
  to_team    text not null,
  from_role  text,
  to_role    text,
  phase      text,                 -- slug em mz_phases
  summary    text,                 -- PII-safe: contagens/descrição, NUNCA corpo de mensagem
  payload    jsonb not null default '{}'::jsonb,  -- metadados (ex.: {"steps":3})
  created_at timestamptz not null default now()
);
create index if not exists mz_handoffs_user_created_idx on mz_handoffs (user_id, created_at desc);
create index if not exists mz_handoffs_mission_idx on mz_handoffs (mission_id);

-- RLS
alter table mz_teams    enable row level security;
alter table mz_phases   enable row level security;
alter table mz_handoffs enable row level security;

-- catálogos: leitura p/ qualquer autenticado
drop policy if exists mz_teams_read on mz_teams;
create policy mz_teams_read on mz_teams for select to authenticated using (true);
drop policy if exists mz_phases_read on mz_phases;
create policy mz_phases_read on mz_phases for select to authenticated using (true);

-- handoffs: owner-only, APPEND-ONLY (sem update/delete policy)
drop policy if exists mz_handoffs_read on mz_handoffs;
create policy mz_handoffs_read on mz_handoffs for select to authenticated using (user_id = auth.uid());
drop policy if exists mz_handoffs_insert on mz_handoffs;
create policy mz_handoffs_insert on mz_handoffs for insert to authenticated with check (user_id = auth.uid());

commit;

-- ======================= RPCs (SECURITY DEFINER, PII-safe, escopo owner) =======================

-- Times do usuário: catálogo + atividade agregada (runs/tokens/missões) por time via role_hint.
create or replace function mz_get_my_teams()
returns table (
  slug text, name text, color text, ord int, description text,
  runs bigint, tokens numeric, missions bigint, last_active timestamptz
)
language sql security definer set search_path = public as $$
  select t.slug, t.name, t.color, t.ord, t.description,
         coalesce(a.runs, 0)        as runs,
         coalesce(a.tokens, 0)      as tokens,
         coalesce(a.missions, 0)    as missions,
         a.last_active
  from mz_teams t
  left join (
    select r.role,
           count(*)                       as runs,
           sum(coalesce(r.tokens_used,0)) as tokens,
           count(distinct r.mission_id)   as missions,
           max(r.ended_at)                as last_active
    from mz_agent_runs r
    where r.user_id = auth.uid()
    group by r.role
  ) a on a.role = t.role_hint
  order by t.ord;
$$;

-- Trocas recentes do usuário (newest-first), com nomes dos times e goal da missão.
create or replace function mz_get_my_handoffs(p_limit int default 40)
returns table (
  id uuid, mission_id uuid, mission_goal text,
  from_team text, from_team_name text, to_team text, to_team_name text,
  phase text, summary text, payload jsonb, created_at timestamptz
)
language sql security definer set search_path = public as $$
  select h.id, h.mission_id, left(m.goal, 80) as mission_goal,
         h.from_team, ft.name as from_team_name,
         h.to_team,   tt.name as to_team_name,
         h.phase, h.summary, h.payload, h.created_at
  from mz_handoffs h
  left join mz_missions m on m.id = h.mission_id
  left join mz_teams ft on ft.slug = h.from_team
  left join mz_teams tt on tt.slug = h.to_team
  where h.user_id = auth.uid()
  order by h.created_at desc
  limit greatest(1, least(coalesce(p_limit, 40), 200));
$$;

-- Progresso por fase do workflow: total/done/failed + tokens por fase (catálogo à esquerda).
create or replace function mz_get_my_phase_progress()
returns table (
  slug text, name text, ord int,
  total bigint, done bigint, failed bigint, running bigint, tokens numeric
)
language sql security definer set search_path = public as $$
  select p.slug, p.name, p.ord,
         coalesce(a.total, 0)   as total,
         coalesce(a.done, 0)    as done,
         coalesce(a.failed, 0)  as failed,
         coalesce(a.running, 0) as running,
         coalesce(a.tokens, 0)  as tokens
  from mz_phases p
  left join (
    select coalesce(r.phase_id, 'build') as phase,
           count(*)                                          as total,
           count(*) filter (where r.status = 'done')         as done,
           count(*) filter (where r.status = 'failed')       as failed,
           count(*) filter (where r.status = 'running')      as running,
           sum(coalesce(r.tokens_used,0))                    as tokens
    from mz_agent_runs r
    where r.user_id = auth.uid()
    group by coalesce(r.phase_id, 'build')
  ) a on a.phase = p.slug
  order by p.ord;
$$;

grant execute on function mz_get_my_teams()          to authenticated;
grant execute on function mz_get_my_handoffs(int)    to authenticated;
grant execute on function mz_get_my_phase_progress() to authenticated;
