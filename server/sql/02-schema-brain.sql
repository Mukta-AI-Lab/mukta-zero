-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- ============================================================================
-- schema-brain.sql
-- Slice idempotente do "cérebro-real" do Mukta Zero para instância Supabase-parity
-- independente (schema public; roles authenticated / service_role / anon já existem).
--
-- Ordem: (a) extensões + helper estrutural  (b) tabelas (FK-ordenadas)
--        (c) índices  (d) seeds  (e) triggers  (f) RPCs  (g) helpers hand-authored
--        (h) grants  (i) reload schema.
--
-- FKs para tabelas NÃO extraídas foram REMOVIDAS (colunas UUID preservadas) para o
-- arquivo rodar numa instância bare; cada remoção está marcada com "-- TODO DEP FALTANTE".
-- FKs entre objetos deste slice e self-FKs foram MANTIDAS. Lista completa de deps ausentes
-- no bloco final "=== DEPS FALTANTES ===".
--
-- RLS NÃO é habilitada aqui (acesso via service-role interno). Tabelas que na origem têm
-- RLS por company/user estão anotadas com "-- RLS RECOMENDADO".
-- ============================================================================

set check_function_bodies = off;  -- permite criar SQL fns que referenciam deps ainda ausentes (padrão pg_dump)

-- ---------------------------------------------------------------------------
-- (a) EXTENSÕES
-- ---------------------------------------------------------------------------
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- Helper estrutural (touch de updated_at) — necessário ANTES das tabelas cujos
-- triggers o referenciam (agent_tools, memory_nodes). Não veio do repo.
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- (b) TABELAS (ordem topológica por FK dentro do slice)
-- ---------------------------------------------------------------------------

-- internal_config -----------------------------------------------------------
-- RLS RECOMENDADO: service_role only (secrets store). Desabilitada nesta instância.
create table if not exists public.internal_config (
  config_key   text        not null,
  config_value text        not null,
  description  text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  constraint internal_config_pkey primary key (config_key)
);

-- llm_role_defaults ---------------------------------------------------------
-- TODO DEP FALTANTE: public.llm_models (FK llm_role_defaults.llm_model_id -> llm_models.id, removida)
create table if not exists public.llm_role_defaults (
  role          text        not null primary key,
  llm_model_id  uuid        not null,
  description   text        null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- memory_topics -------------------------------------------------------------
create table if not exists public.memory_topics (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid references public.memory_topics(id) on delete cascade,
  slug          text not null,
  display_name  text not null,
  department    text,
  depth         integer not null default 0,
  description   text,
  is_system     boolean default false,
  created_at    timestamptz default now(),
  unique (parent_id, slug)
);

-- memory_nodes --------------------------------------------------------------
-- TODO DEP FALTANTE: public.companies (FK company_id, removida)
-- TODO DEP FALTANTE: public.agent_profiles (FK agent_id, removida)
-- TODO DEP FALTANTE: public.projects (FK project_id, removida)
-- RLS RECOMENDADO: por scope/company/agent/user/project.
create table if not exists public.memory_nodes (
  id uuid primary key default gen_random_uuid(),

  scope text not null check (scope in ('system', 'company', 'agent', 'user', 'project')),
  company_id uuid,
  agent_id uuid,
  user_id uuid,

  topic_id uuid references public.memory_topics(id) on delete set null,

  content text not null,
  summary text,
  memory_type text not null default 'learned'
    check (memory_type in (
      'learned','rule','preference','do','dont',
      'error_correction','task_procedure','analysis_pattern'
    )),

  embedding vector(1536),

  confidence_score float default 0.8,
  importance integer default 3 check (importance between 1 and 5),
  approval_status text default 'approved'
    check (approval_status in ('approved', 'pending_review', 'rejected')),
  approved_by uuid,

  source_execution_log_id uuid,
  source_agent_id uuid,

  metadata jsonb default '{}'::jsonb,
  access_count integer default 0,
  last_accessed_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  session_id text,
  session_event_id uuid,

  project_id uuid,
  version_group_id uuid default gen_random_uuid(),
  supersedes_memory_id uuid references public.memory_nodes(id) on delete set null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  evidence_refs jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence_refs) = 'array'),
  trust_score numeric(5,4) not null default 0.7000,

  source_kind text,
  source_ref_table text,
  source_ref_id uuid,
  dedup_key text,
  anonymization_level text not null default 'deterministic_redaction'
    check (anonymization_level in ('none','deterministic_redaction','summary_only','strict_anon')),
  anonymization_version text not null default '2026-03-13.v1',
  pii_redacted_count integer not null default 0 check (pii_redacted_count >= 0),
  auto_learned boolean not null default false,

  inject_mode text not null default 'rag'
    check (inject_mode in ('rag', 'prompt_instruction')),
  promoted_at timestamptz,
  promoted_by uuid,

  fts tsvector generated always as (
    to_tsvector('portuguese', coalesce(content, '') || ' ' || coalesce(summary, ''))
  ) stored
);

-- knowledge_nodes -----------------------------------------------------------
-- TODO DEP FALTANTE: public.knowledge_loads (FK original de load_id, removida)
-- TODO DEP FALTANTE: public.companies / public.agent_profiles / auth.users (FKs originais, removidas)
-- RLS RECOMENDADO: select por company + admin_write.
create table if not exists public.knowledge_nodes (
  id uuid primary key default gen_random_uuid(),
  load_id uuid,
  parent_id uuid references public.knowledge_nodes(id) on delete cascade,
  sequence_index integer,
  content text not null,
  embedding vector(1536),
  fts tsvector,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  company_id uuid,
  agent_id uuid,
  scope text default 'agent',
  node_type text default 'paragraph',
  title text,
  summary text,
  breadcrumb text[] default '{}'::text[],
  knowledge_track text default 'field_learning',
  source_type text default 'imported_doc',
  approval_status text default 'pending_review',
  trust_score numeric(5,4) default 0.7000,
  confidence_score numeric(5,4),
  impact_score numeric(6,3),
  version_group_id uuid,
  version_number integer default 1,
  supersedes_node_id uuid references public.knowledge_nodes(id) on delete set null,
  valid_from timestamptz default now(),
  valid_to timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_by uuid,
  updated_by uuid,
  updated_at timestamptz default now(),
  embedding_qwen vector(1536),
  theme_cluster integer,
  theme_label text,
  retrieval_utility numeric not null default 0,
  retrieval_events integer not null default 0,
  constraint knowledge_nodes_scope_check check (scope in ('system','company','agent')),
  constraint knowledge_nodes_track_check check (knowledge_track in ('strategic_curated','field_learning')),
  constraint knowledge_nodes_source_type_check check (source_type in ('imported_doc','memory_wizard','manual_playbook','crm_insight','expert_feedback','company_strategic_knowledge','bootcamp','erp_sync','marketing_video')),
  constraint knowledge_nodes_approval_status_check check (approval_status in ('draft','pending_review','approved','deprecated','rejected')),
  constraint knowledge_nodes_type_check check (node_type in ('h1','h2','h3','paragraph','chunk_summary','document_summary'))
);

-- agent_tools ---------------------------------------------------------------
-- TODO DEP FALTANTE: public.companies (FK company_id, removida)
-- TODO DEP FALTANTE: auth.users (FK created_by, removida)
-- RLS RECOMENDADO: por company (tools globais = company_id NULL).
create table if not exists public.agent_tools (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  name text not null,
  display_name text not null,
  description text not null,
  tool_type text not null check (tool_type in ('internal', 'webhook', 'memory_function', 'internet_search', 'web_scraping', 'knowledge_base')),
  webhook_url text,
  webhook_method text default 'POST' check (webhook_method in ('GET', 'POST')),
  webhook_headers jsonb default '{}'::jsonb,
  webhook_timeout_ms integer default 10000,
  parameters_schema jsonb not null default '{"type":"object","properties":{},"required":[]}'::jsonb,
  internal_query_config jsonb,
  requires_disclosure boolean default false,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid
);

-- agent_tool_assignments ----------------------------------------------------
-- TODO DEP FALTANTE: public.agent_profiles (FK agent_id, removida)
create table if not exists public.agent_tool_assignments (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  tool_id uuid not null references public.agent_tools(id) on delete cascade,
  custom_instructions text,
  priority integer default 0,
  created_at timestamptz default now(),
  unique (agent_id, tool_id)
);

-- agent_session_memory ------------------------------------------------------
-- TODO DEP FALTANTE: public.agent_profiles / public.companies (FKs removidas)
-- RLS RECOMENDADO: por company (multi-tenant).
create table if not exists public.agent_session_memory (
  session_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  company_id uuid not null,
  memory_context text,
  metadata jsonb default '{}'::jsonb,
  last_updated timestamptz default now(),
  created_at timestamptz default now()
);

-- llm_execution_log ---------------------------------------------------------
-- TODO DEP FALTANTE: public.llm_models (FK llm_model_id, omitida na origem)
create table if not exists public.llm_execution_log (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),
  started_at                timestamptz not null default now(),
  completed_at              timestamptz,
  latency_ms                integer,
  status                    text not null default 'pending',
  source_function           text,
  source_session_id         text,
  role_name                 text,
  agent_id                  uuid,
  project_task_run_id       uuid,
  company_id                uuid,
  actor_user_id             uuid,
  parent_execution_id       uuid references public.llm_execution_log(id) on delete set null,
  llm_model_id              uuid,
  provider                  text,
  model_id                  text,
  prompt_tokens             integer,
  completion_tokens         integer,
  cached_tokens             integer,
  thinking_tokens           integer,
  total_tokens              integer,
  error_code                text,
  error_message             text,
  estimated_input_cost_brl  numeric,
  estimated_output_cost_brl numeric,
  estimated_total_cost_brl  numeric,
  prompt_preview            text,
  response_preview          text,
  billing_fact_input_id     uuid,
  billing_fact_output_id    uuid,
  metadata                  jsonb not null default '{}'::jsonb
);

-- llm_dispatch_audit_log ----------------------------------------------------
create table if not exists public.llm_dispatch_audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company_id uuid,
  actor_user_id uuid,
  agent_id uuid,
  run_id uuid,
  source_caller text not null,
  provider text not null,
  provider_model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  input_cost_brl numeric(12,6) not null default 0,
  output_cost_brl numeric(12,6) not null default 0,
  total_cost_brl numeric(12,6) not null default 0,
  duration_ms integer,
  status text not null default 'success',
  error_code text,
  metadata jsonb not null default '{}'::jsonb
);

-- agent_execution_logs ------------------------------------------------------
-- FKs originais (agent_profiles, companies, agent_session_memory, session_memory_events)
-- OMITIDAS p/ portabilidade; colunas UUID preservadas.
-- RLS RECOMENDADO: por company.
create table if not exists public.agent_execution_logs (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null,
  company_id         uuid not null,
  user_query         text,
  generated_response text,
  decision_trace     jsonb,
  tokens_used        integer,
  completion_status  text,
  error_details      text,
  created_at         timestamptz not null default now(),
  response_text      text,
  thinking_text      text,
  session_id         uuid,
  session_event_id   uuid,
  conversation_id    uuid,
  message_id         uuid
);

-- agent_run_artifacts -------------------------------------------------------
-- RLS RECOMENDADO: system-admin only (ledger fail-closed). Policies originais dependem
-- de public.is_system_admin() — OMITIDAS aqui (RLS não habilitada nesta instância).
create table if not exists public.agent_run_artifacts (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null,
  agent_profile_id       uuid not null,
  conversation_id        uuid,
  message_id             uuid,
  ai_interaction_log_id  uuid,
  agent_execution_log_id uuid,
  session_id             uuid,
  session_event_id       uuid,
  candidate_text_pre_dlp text,
  final_text_post_dlp    text,
  structured_output      jsonb,
  decision_trace         jsonb,
  dlp_violations         jsonb not null default '[]'::jsonb,
  retry_history          jsonb not null default '[]'::jsonb,
  model_calls            jsonb not null default '[]'::jsonb,
  tool_calls             jsonb not null default '[]'::jsonb,
  payload_hash           text not null,
  pii_policy             text not null,
  outcome                text not null,
  retention_until        timestamptz not null,
  created_at             timestamptz not null default now()
);

alter table public.agent_run_artifacts
  drop constraint if exists agent_run_artifacts_pii_policy_check;
alter table public.agent_run_artifacts
  add constraint agent_run_artifacts_pii_policy_check
  check (pii_policy in ('raw','masked','hash_only'));

alter table public.agent_run_artifacts
  drop constraint if exists agent_run_artifacts_outcome_check;
alter table public.agent_run_artifacts
  add constraint agent_run_artifacts_outcome_check
  check (outcome in ('delivered','dlp_blocked','gatekeeper_blocked','handoff','audit_failure'));

-- agent_behavior_violations -------------------------------------------------
-- TODO DEP FALTANTE: public.agent_profiles (FK agent_id, removida)
-- TODO DEP FALTANTE: public.companies (FK company_id, removida)
-- TODO DEP FALTANTE: public.agent_behavior_rule_catalog (FK rule_id, removida)
-- RLS RECOMENDADO: company-scoped (audit P0-07).
create table if not exists public.agent_behavior_violations (
  id uuid not null default gen_random_uuid(),
  rule_id text not null,
  agent_id uuid not null,
  company_id uuid not null,
  source text not null,
  severity text not null,
  conversation_id uuid,
  message_id uuid,
  pair_id uuid,
  ai_interaction_log_id uuid,
  evidence jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  constraint agent_behavior_violations_pkey primary key (id),
  constraint agent_behavior_violations_severity_check
    check (severity = any (array['low'::text, 'medium'::text, 'high'::text, 'critical'::text])),
  constraint agent_behavior_violations_source_check
    check (source = any (array['silent_prepass'::text, 'dlp_runtime'::text, 'judge_llm'::text, 'manual'::text]))
);

-- memory_learning_queue -----------------------------------------------------
-- TODO DEP FALTANTE: public.companies / public.agent_profiles / public.projects / auth.users (FKs removidas)
-- RLS RECOMENDADO: service_role only. (RLS não habilitada nesta instância.)
create table if not exists public.memory_learning_queue (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  company_id uuid not null,
  agent_id uuid,
  project_id uuid,
  source_user_id uuid,
  source_session_id text,
  source_session_event_id uuid,
  source_execution_log_id uuid,
  source_ref_table text,
  source_ref_id uuid,
  dedup_key text not null,
  learning_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_run_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memory_learning_queue_status_check') then
    alter table public.memory_learning_queue
      add constraint memory_learning_queue_status_check
      check (status in ('pending', 'processing', 'retry', 'completed', 'failed', 'cancelled'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'memory_learning_queue_attempts_check') then
    alter table public.memory_learning_queue
      add constraint memory_learning_queue_attempts_check
      check (attempt_count >= 0 and max_attempts >= 1 and attempt_count <= max_attempts + 1);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'memory_learning_queue_payload_object_check') then
    alter table public.memory_learning_queue
      add constraint memory_learning_queue_payload_object_check
      check (jsonb_typeof(learning_payload) = 'object');
  end if;
end $$;

-- memory_learning_runs ------------------------------------------------------
-- RLS RECOMENDADO: service_role only.
create table if not exists public.memory_learning_runs (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.memory_learning_queue(id) on delete cascade,
  worker_id text not null,
  status text not null default 'running',
  attempt_number integer not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  request_payload jsonb,
  response_payload jsonb,
  constraint memory_learning_runs_status_check
    check (status in ('running', 'completed', 'failed', 'cancelled'))
);

-- ---------------------------------------------------------------------------
-- (c) ÍNDICES (btree / parciais / GIN full-text / ivfflat vetorial)
-- ---------------------------------------------------------------------------

-- internal_config
create unique index if not exists internal_config_config_key_key
  on public.internal_config (config_key);

-- llm_role_defaults
create index if not exists idx_llm_role_defaults_llm_model_id
  on public.llm_role_defaults (llm_model_id);

-- memory_topics
create index if not exists idx_memory_topics_parent on public.memory_topics(parent_id);
create index if not exists idx_memory_topics_department on public.memory_topics(department);
create index if not exists idx_memory_topics_slug on public.memory_topics(slug);
create unique index if not exists idx_memory_topics_root_slug_unique
  on public.memory_topics(slug) where parent_id is null;

-- memory_nodes
create index if not exists idx_memory_nodes_scope    on public.memory_nodes(scope);
create index if not exists idx_memory_nodes_company  on public.memory_nodes(company_id) where company_id is not null;
create index if not exists idx_memory_nodes_agent    on public.memory_nodes(agent_id)   where agent_id   is not null;
create index if not exists idx_memory_nodes_user     on public.memory_nodes(user_id)    where user_id    is not null;
create index if not exists idx_memory_nodes_topic    on public.memory_nodes(topic_id);
create index if not exists idx_memory_nodes_type     on public.memory_nodes(memory_type);
create index if not exists idx_memory_nodes_approval on public.memory_nodes(approval_status) where scope = 'system';
create index if not exists idx_memory_nodes_session_created on public.memory_nodes(session_id, created_at desc) where session_id is not null;
create index if not exists idx_memory_nodes_session_event   on public.memory_nodes(session_event_id) where session_event_id is not null;
create index if not exists idx_memory_nodes_project         on public.memory_nodes(project_id, created_at desc) where project_id is not null;
create index if not exists idx_memory_nodes_version_group   on public.memory_nodes(version_group_id);
create index if not exists idx_memory_nodes_prompt_instructions
  on public.memory_nodes (company_id, agent_id, inject_mode)
  where inject_mode = 'prompt_instruction' and approval_status = 'approved';
create index if not exists idx_memory_nodes_fts on public.memory_nodes using gin(fts);
create index if not exists idx_memory_nodes_embedding
  on public.memory_nodes using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- knowledge_nodes
create index if not exists knowledge_nodes_embedding_idx      on public.knowledge_nodes using ivfflat (embedding vector_cosine_ops);
create index if not exists knowledge_nodes_embedding_qwen_idx on public.knowledge_nodes using ivfflat (embedding_qwen vector_cosine_ops);
create index if not exists knowledge_nodes_fts_idx            on public.knowledge_nodes using gin (fts);
create index if not exists knowledge_nodes_load_idx           on public.knowledge_nodes(load_id);
create index if not exists knowledge_nodes_parent_idx         on public.knowledge_nodes(parent_id);
create unique index if not exists idx_kn_nodes_load_seq_unique on public.knowledge_nodes(load_id, sequence_index) where load_id is not null and sequence_index is not null;
create index if not exists idx_kn_nodes_company_scope         on public.knowledge_nodes(company_id, scope);
create index if not exists idx_kn_nodes_agent                 on public.knowledge_nodes(agent_id) where agent_id is not null;
create index if not exists idx_kn_nodes_track_status          on public.knowledge_nodes(knowledge_track, approval_status);
create index if not exists idx_kn_nodes_version_group         on public.knowledge_nodes(version_group_id, version_number desc);
create index if not exists idx_kn_nodes_validity              on public.knowledge_nodes(valid_from, valid_to);
create index if not exists idx_knowledge_nodes_theme          on public.knowledge_nodes(theme_cluster) where theme_cluster is not null;

-- agent_tools
create index if not exists idx_agent_tools_company on public.agent_tools (company_id);
create unique index if not exists idx_agent_tools_name_unique
  on public.agent_tools ((coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid)), name);
create index if not exists idx_agent_tools_active
  on public.agent_tools (company_id, is_active) where is_active = true;

-- agent_tool_assignments
create index if not exists idx_tool_assignments_agent on public.agent_tool_assignments(agent_id);
create index if not exists idx_tool_assignments_tool  on public.agent_tool_assignments(tool_id);

-- agent_session_memory
create index if not exists idx_agent_session_memory_agent_id   on public.agent_session_memory(agent_id);
create index if not exists idx_agent_session_memory_company_id on public.agent_session_memory(company_id);

-- llm_execution_log
create index if not exists llm_execution_log_source_started_idx    on public.llm_execution_log (source_function, started_at desc);
create index if not exists llm_execution_log_created_at_idx        on public.llm_execution_log (created_at desc);
create index if not exists llm_execution_log_started_at_idx        on public.llm_execution_log (started_at desc);
create index if not exists llm_execution_log_company_id_idx        on public.llm_execution_log (company_id);
create index if not exists llm_execution_log_agent_id_idx          on public.llm_execution_log (agent_id);
create index if not exists llm_execution_log_status_idx            on public.llm_execution_log (status);
create index if not exists llm_execution_log_parent_execution_id_idx on public.llm_execution_log (parent_execution_id);
create index if not exists llm_execution_log_llm_model_id_idx      on public.llm_execution_log (llm_model_id);
create index if not exists llm_execution_log_project_task_run_id_idx on public.llm_execution_log (project_task_run_id);

-- llm_dispatch_audit_log
create index if not exists idx_llm_dispatch_audit_company_created on public.llm_dispatch_audit_log using btree (company_id, created_at desc);
create index if not exists idx_llm_dispatch_audit_source_created  on public.llm_dispatch_audit_log using btree (source_caller, created_at desc);
create index if not exists idx_llm_dispatch_audit_run             on public.llm_dispatch_audit_log using btree (run_id) where (run_id is not null);

-- agent_execution_logs
create index if not exists idx_agent_execution_logs_company_date  on public.agent_execution_logs (company_id, created_at desc);
create index if not exists idx_agent_logs_created_at              on public.agent_execution_logs (created_at desc);
create index if not exists idx_agent_execution_logs_session       on public.agent_execution_logs (session_id);
create index if not exists idx_agent_execution_logs_session_event on public.agent_execution_logs (session_event_id);

-- agent_run_artifacts
create index if not exists idx_run_artifacts_conversation
  on public.agent_run_artifacts(conversation_id, created_at desc) where conversation_id is not null;
create index if not exists idx_run_artifacts_message
  on public.agent_run_artifacts(message_id) where message_id is not null;
create index if not exists idx_run_artifacts_exec_log
  on public.agent_run_artifacts(agent_execution_log_id) where agent_execution_log_id is not null;
create index if not exists idx_run_artifacts_ai_log
  on public.agent_run_artifacts(ai_interaction_log_id) where ai_interaction_log_id is not null;
create index if not exists idx_run_artifacts_outcome_company
  on public.agent_run_artifacts(company_id, outcome, created_at desc);
create index if not exists idx_run_artifacts_retention
  on public.agent_run_artifacts(retention_until);

-- agent_behavior_violations
create index if not exists idx_behavior_violations_agent_time on public.agent_behavior_violations using btree (agent_id, detected_at desc);
create index if not exists idx_behavior_violations_rule_time  on public.agent_behavior_violations using btree (rule_id, detected_at desc);
create index if not exists idx_behavior_violations_source     on public.agent_behavior_violations using btree (source, detected_at desc);
create index if not exists idx_behavior_violations_conversation
  on public.agent_behavior_violations using btree (conversation_id) where (conversation_id is not null);

-- memory_learning_queue
create unique index if not exists idx_memory_learning_queue_dedup_key
  on public.memory_learning_queue(dedup_key);
create index if not exists idx_memory_learning_queue_claim
  on public.memory_learning_queue(status, next_run_at, created_at);

-- memory_learning_runs
create index if not exists idx_memory_learning_runs_queue
  on public.memory_learning_runs(queue_id, started_at desc);

-- ---------------------------------------------------------------------------
-- (d) SEEDS (após índices — o unique parcial de raiz garante idempotência do seed)
-- ---------------------------------------------------------------------------
insert into public.memory_topics (slug, display_name, department, depth, is_system, parent_id) values
  ('sales',              'Sales',              'sales',              0, true, null),
  ('legal',              'Legal',              'legal',              0, true, null),
  ('support',            'Support',            'support',            0, true, null),
  ('hr',                 'Human Resources',    'hr',                 0, true, null),
  ('marketing',          'Marketing',          'marketing',          0, true, null),
  ('accounting',         'Accounting',         'accounting',         0, true, null),
  ('business_strategy',  'Business Strategy',  'business_strategy',  0, true, null),
  ('general',            'General',            'general',            0, true, null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- (e) TRIGGERS + funções de trigger associadas às tabelas
-- ---------------------------------------------------------------------------

-- agent_tools.updated_at
drop trigger if exists update_agent_tools_updated_at on public.agent_tools;
create trigger update_agent_tools_updated_at
  before update on public.agent_tools
  for each row execute function public.update_updated_at_column();

-- memory_nodes.updated_at (guardado; a fn existe no prelude)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'update_updated_at_column') then
    drop trigger if exists update_memory_nodes_updated_at on public.memory_nodes;
    create trigger update_memory_nodes_updated_at
      before update on public.memory_nodes
      for each row execute function public.update_updated_at_column();
  end if;
end $$;

-- agent_run_artifacts: exige >=1 correlation id
create or replace function public.validate_run_artifact_correlation()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.conversation_id is null
     and new.ai_interaction_log_id is null
     and new.agent_execution_log_id is null
     and new.session_event_id is null then
    raise exception 'agent_run_artifacts requires at least one correlation id (conversation_id, ai_interaction_log_id, agent_execution_log_id, or session_event_id)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_run_artifact_correlation on public.agent_run_artifacts;
create trigger trg_validate_run_artifact_correlation
  before insert on public.agent_run_artifacts
  for each row execute function public.validate_run_artifact_correlation();

-- memory_learning_queue.updated_at
create or replace function public.set_memory_learning_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_memory_learning_queue_updated_at on public.memory_learning_queue;
create trigger trg_memory_learning_queue_updated_at
before update on public.memory_learning_queue
for each row
execute function public.set_memory_learning_updated_at();

-- ---------------------------------------------------------------------------
-- (f) FUNCTIONS / RPCs extraídas (verbatim das versões finais)
-- ---------------------------------------------------------------------------

-- get_internal_config -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_internal_config(p_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value text;
BEGIN
  SELECT config_value
    INTO v_value
  FROM public.internal_config
  WHERE LOWER(config_key) = LOWER(p_key)
  LIMIT 1;

  RETURN v_value;
END;
$$;

REVOKE ALL ON FUNCTION public.get_internal_config(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_internal_config(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_internal_config(text) TO authenticated, service_role;

-- get_effective_rag_flag ----------------------------------------------------
-- TODO DEP FALTANTE: public.agent_profiles, public.agent_rag_flags, public.company_rag_flags,
--                    public.is_super_admin(uuid), public.get_user_company_ids(uuid), auth.uid()
CREATE OR REPLACE FUNCTION public.get_effective_rag_flag(
  p_key TEXT,
  p_company_id UUID DEFAULT NULL,
  p_agent_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value TEXT;
  v_actor UUID;
  v_actor_companies UUID[];
  v_agent_company UUID;
BEGIN
  v_actor := auth.uid();

  -- Authenticated non-super-admin callers are restricted to their company scope.
  IF v_actor IS NOT NULL AND NOT public.is_super_admin(v_actor) THEN
    v_actor_companies := COALESCE(public.get_user_company_ids(v_actor), ARRAY[]::UUID[]);

    IF p_agent_id IS NOT NULL THEN
      SELECT ap.company_id
        INTO v_agent_company
        FROM public.agent_profiles ap
       WHERE ap.id = p_agent_id
       LIMIT 1;

      IF v_agent_company IS NULL OR NOT (v_agent_company = ANY(v_actor_companies)) THEN
        RAISE EXCEPTION 'Not authorized to read rag flag for this agent';
      END IF;
    ELSIF p_company_id IS NOT NULL THEN
      IF NOT (p_company_id = ANY(v_actor_companies)) THEN
        RAISE EXCEPTION 'Not authorized to read rag flag for this company';
      END IF;
    END IF;
  END IF;

  IF p_agent_id IS NOT NULL THEN
    SELECT arf.config_value
      INTO v_value
      FROM public.agent_rag_flags arf
     WHERE arf.agent_id = p_agent_id
       AND LOWER(arf.config_key) = LOWER(p_key)
     LIMIT 1;

    IF v_value IS NOT NULL THEN
      RETURN v_value;
    END IF;
  END IF;

  IF p_company_id IS NOT NULL THEN
    SELECT crf.config_value
      INTO v_value
      FROM public.company_rag_flags crf
     WHERE crf.company_id = p_company_id
       AND LOWER(crf.config_key) = LOWER(p_key)
     LIMIT 1;

    IF v_value IS NOT NULL THEN
      RETURN v_value;
    END IF;
  END IF;

  RETURN public.get_internal_config(p_key);
END;
$$;

REVOKE ALL ON FUNCTION public.get_effective_rag_flag(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_effective_rag_flag(TEXT, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_effective_rag_flag(TEXT, UUID, UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_effective_rag_flag(TEXT, UUID, UUID) IS
'Returns effective RAG flag value using precedence agent > company > internal_config.';

-- get_company_memory_config -------------------------------------------------
-- TODO DEP FALTANTE: public.company_memory_config (LEFT JOIN — sem ela dá erro em runtime)
CREATE OR REPLACE FUNCTION public.get_company_memory_config(
    p_company_id uuid
)
RETURNS TABLE (
    auto_approve_agent boolean,
    auto_approve_company boolean,
    confidence_threshold_agent numeric,
    confidence_threshold_company numeric
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        COALESCE(cmc.auto_approve_agent, true),
        COALESCE(cmc.auto_approve_company, true),
        COALESCE(cmc.confidence_threshold_agent, 0.80),
        COALESCE(cmc.confidence_threshold_company, 0.80)
    FROM (SELECT 1) AS dummy
    LEFT JOIN public.company_memory_config cmc ON cmc.company_id = p_company_id;
$$;

REVOKE ALL ON FUNCTION public.get_company_memory_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_memory_config(uuid) TO authenticated, service_role;

-- get_prompt_instruction_memories -------------------------------------------
DROP FUNCTION IF EXISTS public.get_prompt_instruction_memories(UUID, UUID);
DROP FUNCTION IF EXISTS public.get_prompt_instruction_memories(UUID, UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_prompt_instruction_memories(
  p_company_id UUID,
  p_agent_id UUID DEFAULT NULL,
  p_project_id UUID DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  scope TEXT,
  content TEXT,
  summary TEXT,
  memory_type TEXT,
  importance INTEGER,
  agent_id UUID,
  inject_mode TEXT,
  promoted_at TIMESTAMPTZ,
  promoted_by UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    mn.id,
    mn.scope,
    mn.content,
    mn.summary,
    mn.memory_type,
    mn.importance,
    mn.agent_id,
    mn.inject_mode,
    mn.promoted_at,
    mn.promoted_by
  FROM public.memory_nodes mn
  WHERE mn.inject_mode = 'prompt_instruction'
    AND mn.approval_status = 'approved'
    AND (
      (mn.scope = 'project' AND p_project_id IS NOT NULL AND mn.project_id = p_project_id)
      OR (mn.scope = 'company' AND mn.company_id = p_company_id)
      OR (mn.scope = 'agent' AND mn.agent_id = p_agent_id AND p_agent_id IS NOT NULL)
      OR (mn.scope = 'system')
    )
  ORDER BY
    CASE mn.scope
      WHEN 'project' THEN 4
      WHEN 'company' THEN 3
      WHEN 'agent' THEN 2
      ELSE 1
    END DESC,
    mn.importance DESC NULLS LAST,
    mn.promoted_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_prompt_instruction_memories(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_prompt_instruction_memories(UUID, UUID, UUID) TO authenticated, service_role;

-- search_memory_tree --------------------------------------------------------
-- TODO DEP FALTANTE: public.can_access_project_context(uuid) (chamada quando p_project_id != null)
create or replace function public.search_memory_tree(
  query_embedding vector,
  query_text text default ''::text,
  p_company_id uuid default null::uuid,
  p_agent_id uuid default null::uuid,
  p_user_id uuid default null::uuid,
  p_topic_id uuid default null::uuid,
  p_memory_types text[] default null::text[],
  match_threshold double precision default 0.6,
  match_count integer default 10,
  semantic_weight double precision default 0.7,
  full_text_weight double precision default 0.3,
  p_scope_weight_system double precision default 1.0,
  p_scope_weight_company double precision default 1.2,
  p_scope_weight_agent double precision default 1.1,
  p_scope_weight_user double precision default 1.15,
  p_include_topic_descendants boolean default true,
  p_topic_slug text default null::text,
  p_allowed_scopes text[] default null::text[],
  p_recency_half_life_days double precision default 14,
  p_scope_weight_project double precision default 1.35,
  p_project_id uuid default null::uuid
)
returns table(
  id uuid,
  scope text,
  content text,
  summary text,
  memory_type text,
  topic_slug text,
  topic_name text,
  importance integer,
  confidence_score double precision,
  similarity double precision,
  rank_score double precision
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_topic_id uuid;
  v_half_life_days double precision;
begin
  if p_project_id is not null and not public.can_access_project_context(p_project_id) then
    raise exception 'access_denied_project_memory';
  end if;

  v_topic_id := p_topic_id;

  if v_topic_id is null and p_topic_slug is not null and length(trim(p_topic_slug)) > 0 then
    select mt.id
      into v_topic_id
      from public.memory_topics mt
     where mt.slug = trim(p_topic_slug)
     limit 1;
  end if;

  v_half_life_days := greatest(coalesce(p_recency_half_life_days, 14), 0);

  return query
  with recursive topic_tree as (
    select mt.id as topic_id
    from public.memory_topics mt
    where v_topic_id is not null
      and mt.id = v_topic_id

    union all

    select child.id as topic_id
    from public.memory_topics child
    join topic_tree parent on child.parent_id = parent.topic_id
    where p_include_topic_descendants
  ),
  scope_filter as (
    select mn.*
    from public.memory_nodes mn
    where mn.approval_status = 'approved'
      and (
        p_allowed_scopes is null
        or cardinality(p_allowed_scopes) = 0
        or mn.scope = any(p_allowed_scopes)
      )
      and (
        mn.scope = 'system'
        or (mn.scope = 'company' and mn.company_id = p_company_id)
        or (mn.scope = 'agent' and mn.agent_id = p_agent_id)
        or (mn.scope = 'user' and mn.user_id = p_user_id)
        or (mn.scope = 'project' and mn.project_id = p_project_id)
      )
      and (
        v_topic_id is null
        or (
          p_include_topic_descendants
          and mn.topic_id in (select tt.topic_id from topic_tree tt)
        )
        or (
          not p_include_topic_descendants
          and mn.topic_id = v_topic_id
        )
      )
      and (
        p_memory_types is null
        or cardinality(p_memory_types) = 0
        or mn.memory_type = any(p_memory_types)
      )
      and (mn.valid_to is null or mn.valid_to > now())
  ),
  semantic as (
    select sf.id,
           1 - (sf.embedding <=> query_embedding) as sim
    from scope_filter sf
    where sf.embedding is not null
      and 1 - (sf.embedding <=> query_embedding) > match_threshold
  ),
  keyword as (
    select sf.id,
           ts_rank(sf.fts, websearch_to_tsquery('portuguese', query_text)) as kw_rank
    from scope_filter sf
    where query_text is not null
      and length(trim(query_text)) > 0
      and sf.fts @@ websearch_to_tsquery('portuguese', query_text)
  ),
  combined as (
    select
      coalesce(s.id, k.id) as node_id,
      coalesce(s.sim, 0) as sim,
      coalesce(k.kw_rank, 0) as kw,
      (coalesce(s.sim, 0) * semantic_weight + coalesce(k.kw_rank, 0) * full_text_weight) as score
    from semantic s
    full outer join keyword k on s.id = k.id
  )
  select
    mn.id,
    mn.scope,
    mn.content,
    mn.summary,
    mn.memory_type,
    mt.slug as topic_slug,
    mt.display_name as topic_name,
    mn.importance,
    mn.confidence_score,
    c.sim as similarity,
    (
      c.score
      * (
        case mn.scope
          when 'system' then p_scope_weight_system
          when 'company' then p_scope_weight_company
          when 'agent' then p_scope_weight_agent
          when 'user' then p_scope_weight_user
          when 'project' then p_scope_weight_project
          else 1.0
        end
      )
      * greatest(0.2, least(1.5, coalesce(mn.trust_score, 0.7)::double precision))
      * (greatest(1, mn.importance)::float / 5.0)
      * (
        case
          when v_half_life_days <= 0 then 1.0
          else exp(
            -ln(2)
            * (extract(epoch from (now() - mn.created_at)) / 86400.0)
            / v_half_life_days
          )
        end
      )
    ) as rank_score
  from combined c
  join public.memory_nodes mn on mn.id = c.node_id
  left join public.memory_topics mt on mt.id = mn.topic_id
  order by rank_score desc, similarity desc
  limit match_count;
end;
$function$;

-- consult_knowledge_base ----------------------------------------------------
-- TODO DEP FALTANTE: public.knowledge_loads, public.get_user_company_ids(), public.is_super_admin(), auth.jwt()
CREATE OR REPLACE FUNCTION public.consult_knowledge_base(
    p_query_text TEXT,
    p_query_embedding VECTOR(1536),
    p_company_id UUID DEFAULT NULL,
    p_agent_id UUID DEFAULT NULL,
    p_scopes TEXT[] DEFAULT NULL,
    p_match_threshold FLOAT DEFAULT 0.5,
    p_match_count INT DEFAULT 10,
    p_anchor_count INT DEFAULT 3,
    p_context_before INT DEFAULT 1,
    p_context_after INT DEFAULT 1,
    p_include_parent BOOLEAN DEFAULT TRUE,
    p_token_budget INT DEFAULT 2000,
    p_semantic_weight FLOAT DEFAULT 0.7,
    p_full_text_weight FLOAT DEFAULT 0.3,
    p_scope_weight_system FLOAT DEFAULT 1.3,
    p_scope_weight_company FLOAT DEFAULT 1.2,
    p_scope_weight_agent FLOAT DEFAULT 1.1
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    rank_score FLOAT,
    similarity FLOAT,
    scope TEXT,
    source_load_id UUID,
    sequence_index INTEGER,
    parent_id UUID,
    citation TEXT,
    retrieval_stage TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_scopes TEXT[];
    v_query_ts tsquery;
    v_effective_match_count INT;
    v_effective_anchor_count INT;
    v_effective_token_budget INT;
    v_semantic_weight FLOAT;
    v_full_text_weight FLOAT;
    v_scope_weight_system FLOAT;
    v_scope_weight_company FLOAT;
    v_scope_weight_agent FLOAT;
    v_role TEXT := COALESCE(auth.jwt()->>'role', '');
    v_is_service_role BOOLEAN := (v_role = 'service_role');
    v_user_companies UUID[] := COALESCE(public.get_user_company_ids(), ARRAY[]::UUID[]);
BEGIN
    IF p_scopes IS NULL OR cardinality(p_scopes) = 0 THEN
        v_scopes := ARRAY['system', 'company', 'agent'];
    ELSE
        v_scopes := ARRAY(
            SELECT DISTINCT s
            FROM unnest(p_scopes) s
            WHERE s IN ('system', 'company', 'agent')
        );
        IF cardinality(v_scopes) = 0 THEN
            v_scopes := ARRAY['system', 'company', 'agent'];
        END IF;
    END IF;

    IF p_query_text IS NOT NULL AND length(trim(p_query_text)) > 0 THEN
      v_query_ts := websearch_to_tsquery('portuguese', p_query_text);
    ELSE
      v_query_ts := NULL;
    END IF;

    v_effective_anchor_count := GREATEST(1, LEAST(COALESCE(p_anchor_count, 3), 16));
    v_effective_match_count := GREATEST(v_effective_anchor_count, LEAST(COALESCE(p_match_count, 10), 200));
    v_effective_token_budget := GREATEST(200, LEAST(COALESCE(p_token_budget, 2000), 12000));

    v_semantic_weight := GREATEST(0.01, LEAST(COALESCE(p_semantic_weight, 0.7), 0.99));
    v_full_text_weight := GREATEST(0.01, LEAST(COALESCE(p_full_text_weight, 0.3), 0.99));
    IF (v_semantic_weight + v_full_text_weight) > 0 THEN
      v_semantic_weight := v_semantic_weight / (v_semantic_weight + v_full_text_weight);
      v_full_text_weight := 1 - v_semantic_weight;
    END IF;

    v_scope_weight_system := GREATEST(COALESCE(p_scope_weight_system, 1.3), COALESCE(p_scope_weight_company, 1.2), COALESCE(p_scope_weight_agent, 1.1));
    v_scope_weight_company := LEAST(v_scope_weight_system, GREATEST(COALESCE(p_scope_weight_company, 1.2), COALESCE(p_scope_weight_agent, 1.1)));
    v_scope_weight_agent := LEAST(v_scope_weight_company, COALESCE(p_scope_weight_agent, 1.1));

    RETURN QUERY
    WITH scoped AS (
      SELECT
        n.id,
        n.load_id,
        n.parent_id,
        n.sequence_index,
        n.content,
        n.embedding,
        n.fts,
        n.scope,
        n.company_id,
        n.agent_id,
        n.version_group_id,
        n.approval_status,
        n.valid_from,
        n.valid_to,
        l.name AS load_name
      FROM public.knowledge_nodes n
      JOIN public.knowledge_loads l
        ON l.id = n.load_id
      WHERE l.is_active = TRUE
        AND n.scope = ANY(v_scopes)
        AND (
          n.scope = 'system'
          OR (n.scope = 'company' AND p_company_id IS NOT NULL AND n.company_id = p_company_id)
          OR (
            n.scope = 'agent'
            AND p_company_id IS NOT NULL
            AND n.company_id = p_company_id
            AND (p_agent_id IS NULL OR n.agent_id IS NULL OR n.agent_id = p_agent_id)
          )
        )
        AND n.approval_status = 'approved'
        AND n.valid_from <= now()
        AND (n.valid_to IS NULL OR n.valid_to > now())
        AND (
          v_is_service_role
          OR public.is_super_admin()
          OR n.scope = 'system'
          OR n.company_id = ANY(v_user_companies)
        )
    ),
    ranked AS (
      SELECT
        s.*,
        CASE
          WHEN s.embedding IS NULL OR p_query_embedding IS NULL THEN 0::float
          ELSE (1 - (s.embedding <=> p_query_embedding))::float
        END AS sim,
        CASE
          WHEN v_query_ts IS NULL OR s.fts IS NULL THEN 0::float
          ELSE ts_rank(s.fts, v_query_ts)::float
        END AS kw_rank
      FROM scoped s
    ),
    filtered AS (
      SELECT
        r.*,
        (
          (r.sim * v_semantic_weight + r.kw_rank * v_full_text_weight)
          * CASE r.scope
              WHEN 'system' THEN v_scope_weight_system
              WHEN 'company' THEN v_scope_weight_company
              WHEN 'agent' THEN v_scope_weight_agent
              ELSE 1
            END
        )::float AS final_score
      FROM ranked r
      WHERE r.sim >= p_match_threshold
         OR (v_query_ts IS NOT NULL AND r.kw_rank > 0)
    ),
    shortlist AS (
      SELECT *
      FROM filtered
      ORDER BY final_score DESC, sim DESC, id
      LIMIT v_effective_match_count
    ),
    anchors AS (
      SELECT *
      FROM shortlist
      ORDER BY final_score DESC, sim DESC, id
      LIMIT v_effective_anchor_count
    ),
    expanded AS (
      SELECT
        a.id,
        a.content,
        a.final_score::float AS rank_score,
        a.sim::float AS similarity,
        a.scope,
        a.load_id AS source_load_id,
        a.sequence_index,
        a.parent_id,
        (a.load_name || ' (anchor)')::text AS citation,
        'anchor'::text AS retrieval_stage
      FROM anchors a

      UNION ALL

      SELECT
        n.id,
        n.content,
        a.final_score::float AS rank_score,
        0::float AS similarity,
        n.scope,
        n.load_id AS source_load_id,
        n.sequence_index,
        n.parent_id,
        a.load_name::text AS citation,
        'context_neighbor'::text AS retrieval_stage
      FROM scoped n
      JOIN anchors a
        ON n.load_id = a.load_id
       AND n.sequence_index BETWEEN (a.sequence_index - GREATEST(0, COALESCE(p_context_before, 1)))
                                AND (a.sequence_index + GREATEST(0, COALESCE(p_context_after, 1)))
      WHERE n.id <> a.id

      UNION ALL

      SELECT
        p.id,
        p.content,
        a.final_score::float AS rank_score,
        0::float AS similarity,
        p.scope,
        p.load_id AS source_load_id,
        p.sequence_index,
        p.parent_id,
        (a.load_name || ' > ' || COALESCE(p.title, 'parent'))::text AS citation,
        'context_parent'::text AS retrieval_stage
      FROM scoped p
      JOIN anchors a
        ON a.parent_id = p.id
      WHERE p_include_parent = TRUE
    ),
    dedup AS (
      SELECT *
      FROM (
        SELECT
          e.*,
          row_number() OVER (
            PARTITION BY e.id
            ORDER BY
              (CASE WHEN e.retrieval_stage = 'anchor' THEN 1 ELSE 0 END) DESC,
              e.rank_score DESC,
              e.sequence_index ASC
          ) AS rn
        FROM expanded e
      ) ranked_dedup
      WHERE rn = 1
    ),
    budgeted AS (
      SELECT
        d.*,
        GREATEST(1, CEIL(char_length(COALESCE(d.content, '')) / 4.0)::INT) AS estimated_tokens,
        SUM(GREATEST(1, CEIL(char_length(COALESCE(d.content, '')) / 4.0)::INT))
          OVER (ORDER BY d.rank_score DESC, d.id) AS cumulative_tokens
      FROM dedup d
    ),
    under_budget AS (
      SELECT *
      FROM budgeted
      WHERE cumulative_tokens <= v_effective_token_budget
    ),
    fallback_top AS (
      SELECT *
      FROM budgeted
      ORDER BY rank_score DESC, id
      LIMIT 1
    ),
    selected AS (
      SELECT * FROM under_budget
      UNION ALL
      SELECT * FROM fallback_top
    )
    SELECT DISTINCT ON (s.id)
      s.id,
      s.content,
      s.rank_score,
      s.similarity,
      s.scope,
      s.source_load_id,
      s.sequence_index,
      s.parent_id,
      s.citation,
      s.retrieval_stage
    FROM selected s
    ORDER BY s.id, s.rank_score DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.consult_knowledge_base(
  TEXT, VECTOR, UUID, UUID, TEXT[], FLOAT, INT, INT, INT, INT, BOOLEAN, INT, FLOAT, FLOAT, FLOAT, FLOAT, FLOAT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consult_knowledge_base(
  TEXT, VECTOR, UUID, UUID, TEXT[], FLOAT, INT, INT, INT, INT, BOOLEAN, INT, FLOAT, FLOAT, FLOAT, FLOAT, FLOAT
) TO authenticated, service_role;

-- hybrid_search -------------------------------------------------------------
-- TODO DEP FALTANTE: public.agent_embeddings (tabela lida; sem ela dá erro em runtime)
CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_text TEXT,
  query_embedding VECTOR(1536),
  match_threshold FLOAT,
  match_count INT,
  p_company_id UUID,
  full_text_weight FLOAT DEFAULT 1.0,
  semantic_weight FLOAT DEFAULT 1.0
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  similarity FLOAT,
  rank_score FLOAT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    ae.id,
    ae.content,
    1 - (ae.embedding <=> query_embedding) AS similarity,
    (
      (ts_rank(ae.fts, websearch_to_tsquery('portuguese', query_text)) * full_text_weight) +
      ((1 - (ae.embedding <=> query_embedding)) * semantic_weight)
    ) AS rank_score
  FROM agent_embeddings ae
  WHERE ae.company_id = p_company_id
  AND (1 - (ae.embedding <=> query_embedding)) > match_threshold
  ORDER BY rank_score DESC
  LIMIT match_count;
END;
$$;

-- get_session_memory_traceback ----------------------------------------------
-- TODO DEP FALTANTE: public.session_memory_events, public.is_super_admin(), public.get_user_company_ids(), auth.uid()
CREATE OR REPLACE FUNCTION public.get_session_memory_traceback(
    p_session_id TEXT,
    p_company_id UUID,
    p_agent_id UUID,
    p_leaf_event_id UUID DEFAULT NULL,
    p_max_depth INT DEFAULT 12
)
RETURNS TABLE (
    id UUID,
    parent_event_id UUID,
    user_input TEXT,
    assistant_output TEXT,
    session_summary TEXT,
    created_at TIMESTAMPTZ,
    depth INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_leaf_event_id UUID;
    v_depth_limit INT;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NOT (
            public.is_super_admin()
            OR p_company_id = ANY(public.get_user_company_ids())
        ) THEN
            RAISE EXCEPTION 'Not authorized to read session memory traceback';
        END IF;
    END IF;

    v_depth_limit := GREATEST(1, LEAST(COALESCE(p_max_depth, 12), 50));

    IF p_leaf_event_id IS NOT NULL THEN
        v_leaf_event_id := p_leaf_event_id;
    ELSE
        SELECT sme.id
        INTO v_leaf_event_id
        FROM public.session_memory_events sme
        WHERE sme.session_id = p_session_id
          AND sme.company_id = p_company_id
          AND sme.agent_id = p_agent_id
        ORDER BY sme.created_at DESC
        LIMIT 1;
    END IF;

    IF v_leaf_event_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH RECURSIVE trace AS (
        SELECT
            sme.id,
            sme.parent_event_id,
            sme.user_input,
            sme.assistant_output,
            sme.session_summary,
            sme.created_at,
            0::INT AS depth
        FROM public.session_memory_events sme
        WHERE sme.id = v_leaf_event_id
          AND sme.session_id = p_session_id
          AND sme.company_id = p_company_id
          AND sme.agent_id = p_agent_id

        UNION ALL

        SELECT
            parent.id,
            parent.parent_event_id,
            parent.user_input,
            parent.assistant_output,
            parent.session_summary,
            parent.created_at,
            (trace.depth + 1)::INT
        FROM public.session_memory_events parent
        JOIN trace ON trace.parent_event_id = parent.id
        WHERE trace.depth + 1 < v_depth_limit
    )
    SELECT
        trace.id,
        trace.parent_event_id,
        trace.user_input,
        trace.assistant_output,
        trace.session_summary,
        trace.created_at,
        trace.depth
    FROM trace
    ORDER BY trace.depth DESC, trace.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_session_memory_traceback(
    TEXT,
    UUID,
    UUID,
    UUID,
    INT
) TO authenticated, service_role;

-- append_session_memory_event -----------------------------------------------
-- TODO DEP FALTANTE: public.session_memory_events, public.is_super_admin(), public.get_user_company_ids(), auth.uid()
CREATE OR REPLACE FUNCTION public.append_session_memory_event(
    p_session_id TEXT,
    p_company_id UUID,
    p_agent_id UUID,
    p_user_input TEXT,
    p_assistant_output TEXT,
    p_session_summary TEXT,
    p_parent_event_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event_id UUID;
BEGIN
    IF p_session_id IS NULL OR length(trim(p_session_id)) = 0 THEN
        RETURN NULL;
    END IF;

    IF auth.uid() IS NOT NULL THEN
        IF NOT (
            public.is_super_admin()
            OR p_company_id = ANY(public.get_user_company_ids())
        ) THEN
            RAISE EXCEPTION 'Not authorized to append session memory event';
        END IF;
    END IF;

    INSERT INTO public.session_memory_events (
        session_id,
        company_id,
        agent_id,
        parent_event_id,
        user_input,
        assistant_output,
        session_summary,
        metadata
    ) VALUES (
        p_session_id,
        p_company_id,
        p_agent_id,
        p_parent_event_id,
        p_user_input,
        p_assistant_output,
        p_session_summary,
        COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_session_memory_event(
    TEXT,
    UUID,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    UUID,
    JSONB
) TO authenticated, service_role;

-- enqueue_memory_learning_job -----------------------------------------------
create or replace function public.enqueue_memory_learning_job(
  p_job_type text,
  p_company_id uuid,
  p_agent_id uuid default null::uuid,
  p_project_id uuid default null::uuid,
  p_source_user_id uuid default null::uuid,
  p_source_session_id text default null::text,
  p_source_session_event_id uuid default null::uuid,
  p_source_execution_log_id uuid default null::uuid,
  p_source_ref_table text default null::text,
  p_source_ref_id uuid default null::uuid,
  p_dedup_key text default null::text,
  p_learning_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 5
)
returns table(
  id uuid,
  status text,
  dedup_key text
)
language sql
security definer
set search_path to 'public'
as $function$
  with payload as (
    select coalesce(
      nullif(trim(coalesce(p_dedup_key, '')), ''),
      encode(
        digest(
          concat_ws(
            '||',
            coalesce(p_job_type, ''),
            coalesce(p_company_id::text, ''),
            coalesce(p_project_id::text, ''),
            coalesce(p_source_ref_table, ''),
            coalesce(p_source_ref_id::text, ''),
            coalesce(p_source_execution_log_id::text, '')
          ),
          'sha256'
        ),
        'hex'
      )
    ) as resolved_dedup_key
  ),
  upserted as (
    insert into public.memory_learning_queue (
      job_type,
      company_id,
      agent_id,
      project_id,
      source_user_id,
      source_session_id,
      source_session_event_id,
      source_execution_log_id,
      source_ref_table,
      source_ref_id,
      dedup_key,
      learning_payload,
      max_attempts,
      status,
      next_run_at,
      last_error,
      locked_at,
      locked_by
    )
    select
      p_job_type,
      p_company_id,
      p_agent_id,
      p_project_id,
      p_source_user_id,
      p_source_session_id,
      p_source_session_event_id,
      p_source_execution_log_id,
      p_source_ref_table,
      p_source_ref_id,
      payload.resolved_dedup_key,
      coalesce(p_learning_payload, '{}'::jsonb),
      greatest(1, least(coalesce(p_max_attempts, 5), 10)),
      'pending',
      now(),
      null,
      null,
      null
    from payload
    on conflict (dedup_key)
    do update set
      job_type = excluded.job_type,
      company_id = excluded.company_id,
      agent_id = excluded.agent_id,
      project_id = excluded.project_id,
      source_user_id = excluded.source_user_id,
      source_session_id = excluded.source_session_id,
      source_session_event_id = excluded.source_session_event_id,
      source_execution_log_id = excluded.source_execution_log_id,
      source_ref_table = excluded.source_ref_table,
      source_ref_id = excluded.source_ref_id,
      learning_payload = excluded.learning_payload,
      max_attempts = excluded.max_attempts,
      status = case
        when public.memory_learning_queue.status = 'completed' then public.memory_learning_queue.status
        else 'pending'
      end,
      next_run_at = case
        when public.memory_learning_queue.status = 'completed' then public.memory_learning_queue.next_run_at
        else now()
      end,
      last_error = null,
      locked_at = null,
      locked_by = null,
      processed_at = case
        when public.memory_learning_queue.status = 'completed' then public.memory_learning_queue.processed_at
        else null
      end,
      updated_at = now()
    returning public.memory_learning_queue.id, public.memory_learning_queue.status, public.memory_learning_queue.dedup_key
  )
  select upserted.id, upserted.status, upserted.dedup_key
  from upserted;
$function$;

GRANT EXECUTE ON FUNCTION public.enqueue_memory_learning_job(TEXT, UUID, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, UUID, TEXT, JSONB, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- (g) HELPERS HAND-AUTHORED (stubs seguros; não vieram do repo)
-- ---------------------------------------------------------------------------

-- Vault secret reader (Supabase Vault). TODO DEP FALTANTE: vault.decrypted_secrets
create or replace function public.get_vault_secret(secret_name text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select value from vault.secrets where name = secret_name limit 1;  -- instância usa vault custom (name/value plaintext), não vault.decrypted_secrets
$$;

-- Consumo de serviço / billing gate — STUB permissivo.
create or replace function public.consume_service(
  p_company_id uuid default null,
  p_service_key text default null,
  p_amount numeric default 1,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language sql
as $$
  select jsonb_build_object('allowed', true);
$$;

-- Circuit breaker de LLM — STUB (sempre fechado).
create or replace function public.llm_circuit_is_open(
  p_provider text default null,
  p_model text default null
)
returns boolean
language sql
immutable
as $$
  select false;
$$;

create or replace function public.llm_circuit_record_failure(
  p_provider text default null,
  p_model text default null,
  p_error text default null
)
returns void
language plpgsql
as $$
begin
  -- no-op stub
end;
$$;

create or replace function public.llm_circuit_record_success(
  p_provider text default null,
  p_model text default null
)
returns void
language plpgsql
as $$
begin
  -- no-op stub
end;
$$;

-- ---------------------------------------------------------------------------
-- (h) GRANTS
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated, anon, service_role;

grant select, insert, update, delete on
  public.internal_config,
  public.llm_role_defaults,
  public.memory_topics,
  public.memory_nodes,
  public.knowledge_nodes,
  public.agent_tools,
  public.agent_tool_assignments,
  public.agent_session_memory,
  public.llm_execution_log,
  public.llm_dispatch_audit_log,
  public.agent_execution_logs,
  public.agent_run_artifacts,
  public.agent_behavior_violations,
  public.memory_learning_queue,
  public.memory_learning_runs
to authenticated, service_role;

grant execute on all functions in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (i) RELOAD PostgREST schema cache
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- (d.1) SEED mínimo de flags (MVP cérebro-real: billing OFF, RAG on)
-- ---------------------------------------------------------------------------
insert into public.internal_config(config_key, config_value, description) values
  ('billing_enforcement_enabled','false','MVP cérebro-real: billing OFF (consume_service stub permissivo)'),
  ('rag_enabled','true','RAG habilitado')
on conflict (config_key) do update set config_value = excluded.config_value;

-- DO NOTHING (não do update): um reseed/reprovision NÃO deve apagar/flipar o tuning ao-vivo — só GARANTE que um DB fresco
-- nasça com o motor LIGADO (senão o default OFF do código desligaria silenciosamente o D2, lever dominante). As flags
-- persona_enforce/persona_pairs ficam explicitamente OFF (documentam o veredito: persona-v2 refutada, §8-9 do spec).
insert into public.internal_config(config_key, config_value, description) values
  ('reasoning_gate_enabled','true','T1.1 auto-crítica→revisão do DoD textual (F4). NORTH-STAR: verificador CROSS-FAMILY, não intrínseco (2x2 mediu F4-intrínseco net -8/quebra 22%)'),
  ('council_enabled','true','Conselho multi-modelo no caminho complexo (tier brain, !estudo/!audit/!compile)'),
  ('code_exec_enabled','true','ORÁCULO run_code (lever dominante D2 57→98%). NÃO deixar cair p/ OFF num reseed'),
  ('code_primitives_enabled','true','Primitivos vetados (CPF/CNPJ/pt-BR) no run_code python'),
  ('budget_routing_enabled','true','classifyTier roteia brain/budget (não só telemetria)'),
  ('reasoning_gate_xfamily','true','#1: verificador cross-family do reasoning_gate LIGADO 2026-07-22 (T1a: intrínseco net -8/quebra 22% → cross-family +0/quebra 4%; sanity ao vivo 3/3 armadilhas). Remove a regressão viva do intrínseco'),
  ('persona_engine_enabled','true','resolve_active_persona (self/pursue). Framing refutado como GERADOR (§8) — persona sobrevive como JUIZ (2x2 T1a)'),
  ('persona_enforce_enabled','true','gate protect[] — enforce JÁ ON na .107 (verif. T1b), mas INERTE porque protect=[] vazio nas seeds; T1f só popula o protect[] (o flip já está feito)'),
  ('persona_closure_enabled','false','T3 witness: grava persona_closure_events (FEASIBLE_WITNESSED se run_code/oráculo segurou) por turno. OFF até a precisão do witness ser medida (acumular turnos ON)'),
  ('persona_pairs_engine_enabled','false','persona-v2 CAMPO — REFUTADA no teste AGI (Mec-A framing §8 + Mec-B seleção §9); permanece OFF'),
  ('rag_hybrid_enabled','false','Retriever HÍBRIDO semantic+FTS no bloco 5b (achado E2E 2026-07-22: cosine-only recall@k=100% mas não move a resposta; FTS pega termo exato que o cosine enterra). OFF no seed; flip por decisão'),
  ('playbook_learning','false','Agent Playbook Learning: injeta regras de decisão APPROVED do agente (knowledge_nodes metadata.playbook_kind=rule) no system, always-injected. OFF no seed; F0-shadow arma OFF + regras draft (não-injetadas); F1 = flip ON + review_knowledge_node aprova. Handoff mz-persona-learning-oracle-handoff.md')
on conflict (config_key) do nothing;


-- ---------------------------------------------------------------------------
-- (b.1) session_memory_events — tabela REAL usada pelas RPCs de memória de sessão
-- (memory-wizard, migration 20260213180000). A extração criou agent_session_memory
-- por engano; append_session_memory_event/get_session_memory_traceback usam ESTA.
-- session_id é TEXT (aceita o uuid da conversa como string). FK companies removida.
-- ---------------------------------------------------------------------------
create table if not exists public.session_memory_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  company_id uuid not null,
  agent_id uuid not null,
  parent_event_id uuid references public.session_memory_events(id) on delete set null,
  user_input text,
  assistant_output text,
  session_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_session_memory_events_session on public.session_memory_events(session_id, created_at desc);
create index if not exists idx_session_memory_events_parent on public.session_memory_events(parent_event_id);
create index if not exists idx_session_memory_events_company_agent on public.session_memory_events(company_id, agent_id, created_at desc);
grant select, insert, update, delete on public.session_memory_events to authenticated, service_role;

notify pgrst, 'reload schema';

-- ===========================================================================
-- === DEPS FALTANTES (não presentes no slice; recrie/ligue FKs se necessário) ===
-- Tabelas:
--   public.llm_models                    (FK de llm_role_defaults.llm_model_id, llm_execution_log.llm_model_id)
--   public.companies                     (FK de memory_nodes, agent_tools, agent_session_memory,
--                                          agent_behavior_violations, memory_learning_queue, agent_execution_logs)
--   public.agent_profiles                (FK de memory_nodes, agent_tool_assignments, agent_session_memory,
--                                          agent_behavior_violations, memory_learning_queue, agent_execution_logs;
--                                          lida por get_effective_rag_flag)
--   public.projects                      (FK de memory_nodes, memory_learning_queue)
--   public.agent_behavior_rule_catalog   (FK de agent_behavior_violations.rule_id)
--   public.knowledge_loads               (FK lógica de knowledge_nodes.load_id; JOIN em consult_knowledge_base)
--   public.session_memory_events         (INSERT/leitura em append_session_memory_event, get_session_memory_traceback;
--                                          FK lógica de agent_execution_logs)
--   public.agent_embeddings              (lida por hybrid_search)
--   public.company_memory_config         (LEFT JOIN em get_company_memory_config)
--   public.agent_rag_flags               (lida por get_effective_rag_flag)
--   public.company_rag_flags             (lida por get_effective_rag_flag)
--   auth.users                           (FK de agent_tools.created_by, memory_learning_queue.source_user_id)
--   vault.decrypted_secrets              (lida por get_vault_secret — gerenciada pelo Supabase Vault)
-- Funções:
--   public.can_access_project_context(uuid)   (search_memory_tree, quando p_project_id != null)
--   public.is_super_admin()  /  is_super_admin(uuid)  (múltiplas RPCs)
--   public.get_user_company_ids()  /  get_user_company_ids(uuid)  (múltiplas RPCs)
--   public.is_system_admin()   (policies RLS originais de agent_run_artifacts — RLS não habilitada aqui)
--   auth.uid()  /  auth.jwt()  (schema auth do Supabase; usadas nos guards das RPCs)
-- ===========================================================================