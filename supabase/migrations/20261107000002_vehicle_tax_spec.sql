-- 自動車税・重量税の自動計算に使う車検証の項目。2026-11-07 の要望
-- 一度入れてもらえば、自動車税・車検の記録で税額をアプリが出す（supabase/functions/_shared/domain/vehicle-tax.ts）

alter table public.vehicles
  -- standard：普通車・小型車 / kei：軽自動車
  add column vehicle_class text check (vehicle_class is null or vehicle_class in ('standard', 'kei')),
  -- 総排気量（cc）
  add column displacement_cc integer check (displacement_cc is null or displacement_cc between 1 and 20000),
  -- 初度登録年月（軽自動車は初度検査年月）。月の1日で持つ
  add column first_registered_on date check (first_registered_on is null or extract(day from first_registered_on) = 1),
  -- 燃料（electric は電気・燃料電池、プラグインハイブリッドは hybrid）
  add column powertrain text check (powertrain is null or powertrain in ('gasoline', 'diesel', 'hybrid', 'electric')),
  -- 車両重量（kg）
  add column vehicle_weight_kg integer check (vehicle_weight_kg is null or vehicle_weight_kg between 1 and 30000);

-- 通知の定期実行が読むビューにも新しい列を出す（v.* は作成したときの列で固定されるため作り直す）
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
