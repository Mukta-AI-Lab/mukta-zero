-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- Mukta Zero — Fase 5.3a: registry de golden-master templates PPTX (marker-based {{SLOT}}).
-- Aplicado na instância mukta-zero (<HOST>) via psql no container mz-db.
-- O edge mz-office (action compose_pptx) busca content_b64 por template_id (slug|id) via ctx.sql (service-role),
-- decodifica e aplica slots {SLOT: valor} → edits {{SLOT}}→valor (surgical-fill em <a:t>, preserva estrutura).
-- Os BYTES dos templates (content_b64) são dados de instância (não versionados aqui); seed via script separado.

create table if not exists public.mz_pptx_templates (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  description text not null default '',
  slot_schema jsonb not null default '[]',   -- [{slot,label,max}] — contrato p/ o LLM planner (item 3b)
  content_b64 text not null,                  -- golden-master PPTX (base64) com markers {{SLOT}}
  created_at  timestamptz not null default now()
);
alter table public.mz_pptx_templates enable row level security;

-- templates são SISTEMA: leitura p/ authenticated (picker/lista slug/name/slot_schema); escrita só via admin/psql.
drop policy if exists tpl_read on public.mz_pptx_templates;
create policy tpl_read on public.mz_pptx_templates for select to authenticated using (true);
grant select on public.mz_pptx_templates to authenticated;

notify pgrst, 'reload schema';

-- SEED (exemplo — o base64 real vai por script de instância, não aqui):
-- insert into public.mz_pptx_templates (slug,name,description,slot_schema,content_b64) values
-- ('credcapital-fidc','FIDC CredCapital (capa)','Capa de deck FIDC — TITLE/SUBTITLE/FOOTER',
--  '[{"slot":"TITLE","label":"Título principal","max":40},{"slot":"SUBTITLE","label":"Subtítulo/tese","max":90},{"slot":"FOOTER","label":"Rodapé","max":80}]'::jsonb,
--  '<BASE64_DO_PPTX_COM_MARKERS>')
-- on conflict (slug) do update set content_b64=excluded.content_b64, slot_schema=excluded.slot_schema, name=excluded.name;
