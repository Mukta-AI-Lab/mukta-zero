-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- Workspaces do MZ (extensão do schema-projects.sql Fase 1c). Aplicado na .107.
-- mz_projects/mz_project_files já existem (RLS owner). Extensão p/ ingestão de conteúdo (CSV/planilha/texto):
alter table public.mz_project_files add column if not exists kind text not null default 'file';
alter table public.mz_project_files add column if not exists content_text text;       -- conteúdo parseado (agente lê)
alter table public.mz_project_files add column if not exists meta jsonb not null default '{}'::jsonb; -- {n_rows,headers,preview}
alter table public.mz_project_files alter column storage_path drop not null;           -- conteúdo pode viver em content_text
