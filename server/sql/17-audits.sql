-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
-- Mukta Zero — Fase 8g: AUDITOR/INSPETOR. Persistência dos relatórios de auditoria de missão.
-- O relatório é produzido pela edge audit-mission (fatos determinísticos + veredito do cérebro, SÓ-LEITURA).
-- Aplica no DB da INSTÂNCIA (mz-db).

begin;

create table if not exists mz_agent_audits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  mission_id  uuid not null,
  verdict     text,                 -- ok | atencao | falha
  report      text,                 -- relatório em linguagem natural (cérebro)
  facts       jsonb not null default '{}'::jsonb,  -- fatos determinísticos auditados
  anomalies   jsonb not null default '[]'::jsonb,  -- anomalias detectadas por regra
  model_slug  text,
  tokens_used int,
  created_at  timestamptz not null default now()
);
create index if not exists mz_agent_audits_user_idx on mz_agent_audits (user_id, created_at desc);
create index if not exists mz_agent_audits_mission_idx on mz_agent_audits (mission_id);

alter table mz_agent_audits enable row level security;
drop policy if exists mz_agent_audits_read on mz_agent_audits;
create policy mz_agent_audits_read on mz_agent_audits for select to authenticated using (user_id = auth.uid());
-- inserts vêm da edge (service via sql direto no contrato mukta-edge); sem policy de insert p/ o cliente.

commit;
