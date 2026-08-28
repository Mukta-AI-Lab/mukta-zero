-- Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
-- SPDX-License-Identifier: BUSL-1.1
--
-- Use of this software is governed by the Business Source License 1.1
-- included in the repository LICENSE file. Change License: AGPL-3.0-only
-- Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
create or replace function public.consume_points(p_user_id uuid, p_service_type text, p_points numeric, p_description text default null)
returns jsonb language plpgsql as $func$
declare
  w public.mz_user_wallets%rowtype;
  v_total numeric; v_from_free numeric; v_from_purchased numeric;
begin
  if p_points is null or p_points < 0 then return jsonb_build_object('ok', false, 'error', 'invalid_points'); end if;
  select * into w from public.mz_user_wallets where user_id = p_user_id for update;
  if not found then
    insert into public.mz_user_wallets (user_id) values (p_user_id) returning * into w;
  end if;
  -- reset lazy do free tier mensal
  if w.period_start < date_trunc('month', now())::date then
    w.free_points := 1000; w.period_start := date_trunc('month', now())::date;
  end if;
  v_total := w.free_points + w.purchased_points;
  if p_points > v_total then
    update public.mz_user_wallets set free_points = w.free_points, period_start = w.period_start, updated_at = now() where user_id = p_user_id;
    return jsonb_build_object('ok', false, 'error', 'insufficient_balance', 'balance', v_total, 'required', p_points);
  end if;
  v_from_free := least(w.free_points, p_points);
  v_from_purchased := p_points - v_from_free;
  w.free_points := w.free_points - v_from_free;
  w.purchased_points := w.purchased_points - v_from_purchased;
  update public.mz_user_wallets set free_points = w.free_points, purchased_points = w.purchased_points, period_start = w.period_start, updated_at = now() where user_id = p_user_id;
  insert into public.mz_points_ledger (user_id, delta_points, service_type, description, balance_after)
    values (p_user_id, -p_points, p_service_type, p_description, w.free_points + w.purchased_points);
  return jsonb_build_object('ok', true, 'charged', p_points, 'balance', w.free_points + w.purchased_points, 'free', w.free_points, 'purchased', w.purchased_points);
end;
$func$;
select 'consume_points criada' as ok;
