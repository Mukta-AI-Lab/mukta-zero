-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- schema-research-base.sql — base indexada + grafo (mínimo) do pipeline de pesquisa v2 (mz-research).
-- Aplicar SÓ na .107 via: docker exec -i mz-db psql -U postgres < schema-research-base.sql
-- NUNCA via MCP (aponta pro cloud <SUPABASE_PROJECT_REF>) nem `db push` (P0). Idempotente + transacional.
-- Correção B da crítica adversarial: SEM tabela de arestas ricas no 1º release — grafo de dependência
-- representado por ADJACÊNCIA (parent_id) + o fato carrega sua fonte de suporte em source_ref (SUPPORTED_BY inline).
-- run_id = mz_jobs.id. embedding vector(1536) = dim do SSOT (get_internal_config('embedding_dim')=1536, knowledge_nodes).

\set ON_ERROR_STOP on
begin;

-- (1) GRAFO: nós tipados + adjacência (run→area→subquestion→source/fact)
create table if not exists public.mz_research_nodes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,                               -- = mz_jobs.id
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('run','area','subquestion','source','fact')),
  parent_id uuid references public.mz_research_nodes(id) on delete cascade,  -- adjacência = grafo de dependência
  label text,
  content text default '',                            -- run: charter JSON; fact: statement
  source_ref jsonb default '{}',                      -- source: {url,title,snippet,provider}; fact: {statement,quote,source_id,value,unit}
  status text default 'open',                         -- open|answered|verified|refuted|dropped
  confidence numeric(5,4),
  meta jsonb default '{}',
  created_at timestamptz default now()
);
create unique index if not exists mz_rn_source_uniq on public.mz_research_nodes (run_id, (source_ref->>'url')) where kind='source';
create unique index if not exists mz_rn_aq_uniq     on public.mz_research_nodes (run_id, kind, label)          where kind in ('area','subquestion');
create index if not exists mz_rn_run_kind on public.mz_research_nodes (run_id, kind);
create index if not exists mz_rn_parent   on public.mz_research_nodes (parent_id);

-- (2) BASE INDEXADA: chunks (espelha mz_project_chunks; material bruto verificável). FK = proveniência mínima (#4).
create table if not exists public.mz_research_chunks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null references public.mz_research_nodes(id) on delete cascade,        -- -> nó source
  subquestion_id uuid references public.mz_research_nodes(id) on delete set null,           -- qual swarm produziu
  chunk_idx int not null,
  content text not null,
  tokens int,
  embedding vector(1536),                             -- rota SSOT internal_config (edim=1536)
  fts tsvector,
  meta jsonb default '{}',                            -- {url,title,heading}
  created_at timestamptz default now(),
  unique (source_id, chunk_idx)
);
create trigger mz_rc_fts before insert or update on public.mz_research_chunks
  for each row execute function tsvector_update_trigger(fts, 'pg_catalog.portuguese', content);
create index if not exists mz_rc_fts_gin on public.mz_research_chunks using gin (fts);
create index if not exists mz_rc_run on public.mz_research_chunks (run_id);
-- base pequena/efêmera (dezenas-centenas de chunks/run) → HNSW (pgvector 0.8.2 ok)
create index if not exists mz_rc_vec on public.mz_research_chunks using hnsw (embedding vector_cosine_ops);

-- (3) RPC de retrieval híbrido (SECURITY DEFINER, p_user_id explícito — edge não tem auth.uid()). Clona mz_match_project_chunks.
create or replace function public.mz_match_research_chunks(
  p_user_id uuid, p_run_id uuid, p_query text, p_query_embedding vector,
  p_match_count int default 6, p_subquestion_id uuid default null)
returns table (id uuid, source_id uuid, subquestion_id uuid, content text, similarity float, keyword_rank float, meta jsonb)
language sql security definer set search_path = public as $$
  select c.id, c.source_id, c.subquestion_id, c.content,
         1 - (c.embedding <=> p_query_embedding) as similarity,
         ts_rank(c.fts, plainto_tsquery('portuguese', p_query)) as keyword_rank, c.meta
  from public.mz_research_chunks c
  where c.user_id = p_user_id and c.run_id = p_run_id
    and ( (1 - (c.embedding <=> p_query_embedding)) >= 0.30
          or ts_rank(c.fts, plainto_tsquery('portuguese', p_query)) > 0 )
    and (p_subquestion_id is null or c.subquestion_id = p_subquestion_id)
  order by 0.7*(1 - (c.embedding <=> p_query_embedding)) + 0.3*ts_rank(c.fts, plainto_tsquery('portuguese', p_query)) desc
  limit least(p_match_count, 20);
$$;

-- (4) RLS por dono + grants (defesa se o front ler a base; o edge escreve service-level com user_id explícito)
alter table public.mz_research_nodes  enable row level security;
alter table public.mz_research_chunks enable row level security;
drop policy if exists p_mz_rn on public.mz_research_nodes;
drop policy if exists p_mz_rc on public.mz_research_chunks;
create policy p_mz_rn on public.mz_research_nodes  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy p_mz_rc on public.mz_research_chunks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.mz_research_nodes, public.mz_research_chunks to authenticated;
grant execute on function public.mz_match_research_chunks(uuid,uuid,text,vector,int,uuid) to authenticated, service_role;

-- (5) Perímetro congelado relê barato entre fases (após reciclagem de isolate)
alter table public.mz_jobs add column if not exists perimeter jsonb;

commit;

-- Verificação pós-migração
select 'mz_research_nodes' as obj, count(*) from public.mz_research_nodes
union all select 'mz_research_chunks', count(*) from public.mz_research_chunks
union all select 'rpc mz_match_research_chunks', (select case when to_regprocedure('public.mz_match_research_chunks(uuid,uuid,text,vector,int,uuid)') is null then 0 else 1 end)
union all select 'mz_jobs.perimeter col', (select count(*) from information_schema.columns where table_name='mz_jobs' and column_name='perimeter');
