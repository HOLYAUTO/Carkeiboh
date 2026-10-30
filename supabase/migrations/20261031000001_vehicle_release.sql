-- クルマを手放す（乗り換え・廃車）
-- 方針：
--   * 手放したクルマはアプリから見えなくするが、記録は消さずに残す（乗り換えの次の持ち主へ記録を引き継ぐ仕組みを、のちに作るため。
--     docs/vehicle-history-design.md）。アカウント削除では、これまでどおりすべて消える
--   * 手放したクルマには、だれも記録を足したり直したりできない。台数の上限にも数えない
--   * 手放す操作は、整備工場（Ledra）との連携の解除・廃車の通知と一緒に、サーバー（vehicle-release）だけが行う

alter table public.vehicles
  add column status text not null default 'active' check (status in ('active', 'transferred', 'scrapped')),
  -- 手放した日（利用者が選ぶ。日本時間の日付）と、手放す操作をした日時
  add column released_on date,
  add column released_at timestamptz,
  -- 乗り換えのとき、次の持ち主に記録を引き継いでよいか（本人が選ぶ。既定は引き継がない）
  add column history_share_consent boolean not null default false,
  add constraint vehicles_release_consistent check (
    (status = 'active') = (released_at is null)
    and (status = 'transferred' or not history_share_consent)
  );

create index vehicles_user_active_idx on public.vehicles (user_id) where status = 'active';

-- 利用者（authenticated）は、手放したクルマを書き換えられず、手放す状態も自分では変えられない
create or replace function public.guard_vehicle_release()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;
  if old.status <> 'active' then
    raise exception 'vehicle_released' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (
    new.status is distinct from old.status
    or new.released_on is distinct from old.released_on
    or new.released_at is distinct from old.released_at
    or new.history_share_consent is distinct from old.history_share_consent
  ) then
    raise exception 'release_via_server' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger vehicles_guard_release
  before update or delete on public.vehicles
  for each row execute function public.guard_vehicle_release();

-- 記録（オイル交換・支出・走行距離・メーター交換・期限）は、手放していないクルマにだけ書ける
create or replace function public.ensure_vehicle_active()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;
  select status into v_status
    from public.vehicles
   where id = case when tg_op = 'DELETE' then old.vehicle_id else new.vehicle_id end;
  -- 見つからない（他人の車両など）ときは、外部キーと RLS に任せる
  if v_status is not null and v_status <> 'active' then
    raise exception 'vehicle_released' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.vehicle_id is distinct from old.vehicle_id then
    select status into v_status from public.vehicles where id = old.vehicle_id;
    if v_status is not null and v_status <> 'active' then
      raise exception 'vehicle_released' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['oil_changes', 'expenses', 'odometer_readings', 'meter_replacements', 'deadlines']
  loop
    execute format(
      'create trigger %1$s_ensure_vehicle_active
         before insert or update or delete on public.%1$I
         for each row execute function public.ensure_vehicle_active()', t);
  end loop;
end;
$$;

-- 台数の上限は、手放していないクルマだけで数える
create or replace function public.enforce_vehicle_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_count integer;
begin
  select plan into v_plan from public.profiles where id = new.user_id for update;
  select count(*) into v_count from public.vehicles where user_id = new.user_id and status = 'active';
  if v_count >= public.vehicle_limit(coalesce(v_plan, 'free')) then
    raise exception 'vehicle_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- 廃車にしたことを Ledra に伝え終わっていない連携（定期実行 ledra-sync で再送する）
alter table public.ledra_links
  add column scrap_notify_pending boolean not null default false,
  add column scrapped_on date;
