-- 給油の詳細（給油量・単価・油種・満タン）と、車両の距離の単位（km / mile）。2026-11-05 の要望
-- - かけ売りでレシートがないときは、給油量と単価から合計（揮発油税などの税込）をアプリで出す
-- - 平均燃費は、満タンの給油の走行距離と給油量から満タン法で出す（supabase/functions/_shared/domain/fuel.ts）
-- - 距離は DB ではすべて km で持ち、mile の車両は画面の入力・表示と通知の文だけ mile にする

alter table public.vehicles
  add column distance_unit text not null default 'km' check (distance_unit in ('km', 'mile'));

alter table public.expenses
  -- 給油量（L、0.01L まで）
  add column fuel_liters numeric(6, 2) check (fuel_liters is null or (fuel_liters > 0 and fuel_liters <= 1000)),
  -- 1Lあたりの単価（円、0.1円まで）。税込か税抜かは fuel_price_basis
  add column fuel_unit_price numeric(5, 1) check (fuel_unit_price is null or (fuel_unit_price > 0 and fuel_unit_price <= 9999.9)),
  add column fuel_type text check (fuel_type is null or fuel_type in ('regular', 'premium', 'diesel')),
  -- tax_included：店頭の表示価格 / tax_excluded：かけ売りの請求単価（消費税抜き。軽油は軽油引取税も抜き）
  add column fuel_price_basis text check (fuel_price_basis is null or fuel_price_basis in ('tax_included', 'tax_excluded')),
  -- 満タンにしたか（燃費の計算に使う）
  add column fuel_full_tank boolean,
  add constraint expenses_fuel_details_only_for_fuel check (
    category = 'fuel'
    or (fuel_liters is null and fuel_unit_price is null and fuel_type is null and fuel_price_basis is null and fuel_full_tank is null)
  ),
  -- 単価を入れたら、税込か税抜かも入れる
  add constraint expenses_fuel_price_basis_required check ((fuel_unit_price is null) = (fuel_price_basis is null));

-- 通知の定期実行が読むビューにも distance_unit を出す（v.* は作成したときの列で固定されるため作り直す。
-- 列を末尾に足すだけなので create or replace でき、権限はそのまま残る）
create or replace view public.vehicles_in_service
with (security_invoker = true)
as
select v.*
  from public.vehicles v
 where v.id in (
   select r.id
     from (
       select id, user_id, row_number() over (partition by user_id order by created_at, id) as rn
         from public.vehicles
        where status = 'active' and plan_suspended_at is null
     ) r
    where r.rn <= public.vehicle_limit(public.effective_plan(r.user_id))
 );
