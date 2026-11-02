-- 複数台プランの課金（App Store / Google Play のアプリ内課金。購入の確認はサーバーが自前で行う）
-- 方針（利用規約の下書き 第4条、docs/open-questions.md 30）：
--   * 購入の記録はサーバー（billing-verify / billing-notify / billing-reconcile）だけが書く。利用者は自分の記録を読めるだけ
--   * プランは購入の記録から毎回求める（有効期限を過ぎれば、通知が届かなくても無料プランに戻る）。profiles.plan = 'plus' は運営が手で付ける場合に使う
--   * 解約後に上限を超えたクルマは消さずに「休止」（plan_suspended_at）にする。どれを残すかは利用者が選ぶ（keep_vehicle）
--   * 休止中のクルマは表示・記録・お知らせ・Ledra 連携の対象外。再契約で表示を戻す。休止から90日を過ぎたものは、事務手数料の購入も要る

-- ---------------------------------------------------------------------------
-- 購入の記録
-- ---------------------------------------------------------------------------
create table public.billing_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  -- subscription：複数台プラン（自動更新）、restore_fee：復旧の事務手数料（1回限りの購入）
  kind text not null check (kind in ('subscription', 'restore_fee')),
  product_id text not null,
  -- ストアでの購入の識別子。iOS は定期購入なら originalTransactionId、事務手数料なら transactionId。Android は purchaseToken
  store_ref text not null,
  environment text not null default 'production' check (environment in ('production', 'sandbox')),
  -- 定期購入：この日時まで使える（猶予期間を含む）。使えない状態なら null。事務手数料は null
  entitled_until timestamptz,
  auto_renew boolean,
  -- 返金・取り消しされた日時
  revoked_at timestamptz,
  -- 事務手数料：休止から90日を過ぎたクルマの表示を戻すのに使った日時
  used_at timestamptz,
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 同じ購入を複数のアカウントで使えないようにする
  unique (platform, store_ref),
  check (kind = 'restore_fee' or used_at is null),
  check (kind = 'subscription' or entitled_until is null)
);

create index billing_purchases_user_idx on public.billing_purchases (user_id);

create trigger billing_purchases_set_updated_at
  before update on public.billing_purchases
  for each row execute function public.set_updated_at();

alter table public.billing_purchases enable row level security;
revoke all on public.billing_purchases from anon;
revoke insert, update, delete on public.billing_purchases from authenticated;
create policy "billing_purchases: 本人のみ参照" on public.billing_purchases
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 休止中のクルマ
-- ---------------------------------------------------------------------------
alter table public.vehicles add column plan_suspended_at timestamptz;

create index vehicles_user_visible_idx on public.vehicles (user_id)
  where status = 'active' and plan_suspended_at is null;

-- 休止から、事務手数料なしで表示を戻せる日数
create or replace function public.plan_restore_grace_days()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 90;
$$;

-- いまのプラン。運営が付けた plus か、使える期間内の定期購入があれば plus
create or replace function public.effective_plan(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.profiles where id = p_user_id and plan = 'plus')
      or exists (
        select 1 from public.billing_purchases
         where user_id = p_user_id
           and kind = 'subscription'
           and revoked_at is null
           and entitled_until > now()
      )
    then 'plus'
    else 'free'
  end;
$$;

-- 台数の上限は、手放しておらず休止もしていないクルマで数える
create or replace function public.enforce_vehicle_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform 1 from public.profiles where id = new.user_id for update;
  select count(*) into v_count
    from public.vehicles
   where user_id = new.user_id and status = 'active' and plan_suspended_at is null;
  if v_count >= public.vehicle_limit(public.effective_plan(new.user_id)) then
    raise exception 'vehicle_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- 利用者（authenticated）は休止中のクルマを書き換えられず、休止の状態も自分では変えられない
create or replace function public.guard_plan_suspension()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if new.plan_suspended_at is not null then
      raise exception 'suspend_via_server' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.plan_suspended_at is not null then
    raise exception 'vehicle_suspended' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.plan_suspended_at is distinct from old.plan_suspended_at then
    raise exception 'suspend_via_server' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger vehicles_guard_plan_suspension
  before insert or update or delete on public.vehicles
  for each row execute function public.guard_plan_suspension();

-- 記録（オイル交換・支出・走行距離・メーター交換・期限）は、手放しておらず休止もしていないクルマにだけ書ける
create or replace function public.ensure_vehicle_active()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_suspended timestamptz;
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;
  select status, plan_suspended_at into v_status, v_suspended
    from public.vehicles
   where id = case when tg_op = 'DELETE' then old.vehicle_id else new.vehicle_id end;
  -- 見つからない（他人の車両など）ときは、外部キーと RLS に任せる
  if v_status is not null and v_status <> 'active' then
    raise exception 'vehicle_released' using errcode = 'P0001';
  end if;
  if v_suspended is not null then
    raise exception 'vehicle_suspended' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.vehicle_id is distinct from old.vehicle_id then
    select status, plan_suspended_at into v_status, v_suspended from public.vehicles where id = old.vehicle_id;
    if v_status is not null and v_status <> 'active' then
      raise exception 'vehicle_released' using errcode = 'P0001';
    end if;
    if v_suspended is not null then
      raise exception 'vehicle_suspended' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- お知らせ・Ledra 連携の対象にするクルマ（サーバー用）。
-- 解約後、残すクルマを利用者がまだ選んでいない間は、登録の古い順に上限の台数までを対象にする
create view public.vehicles_in_service
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

revoke all on public.vehicles_in_service from anon, authenticated;
grant select on public.vehicles_in_service to service_role;

-- ---------------------------------------------------------------------------
-- 休止と表示の戻し
-- ---------------------------------------------------------------------------

-- 休止中のクルマの表示を戻す（サーバー用。プランが plus のときだけ）。
-- 休止から90日以内のものはそのまま、過ぎたものは未使用の事務手数料が1件あれば、それを使って戻す。戻した台数を返す
create or replace function public.apply_plan_restore(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room integer;
  v_recent integer;
  v_old integer;
  v_fee uuid;
  v_cutoff timestamptz := now() - make_interval(days => public.plan_restore_grace_days());
begin
  -- 同じ利用者の購入の確認・残すクルマの選択と重ならないようにする
  perform 1 from public.profiles where id = p_user_id for update;
  if public.effective_plan(p_user_id) <> 'plus' then
    return 0;
  end if;

  select public.vehicle_limit('plus') - count(*) into v_room
    from public.vehicles
   where user_id = p_user_id and status = 'active' and plan_suspended_at is null;
  if v_room <= 0 then
    return 0;
  end if;

  with picked as (
    select id from public.vehicles
     where user_id = p_user_id and status = 'active' and plan_suspended_at >= v_cutoff
     order by plan_suspended_at desc, created_at
     limit v_room
  )
  update public.vehicles v set plan_suspended_at = null
    from picked where v.id = picked.id;
  get diagnostics v_recent = row_count;
  v_room := v_room - v_recent;

  v_old := 0;
  if v_room > 0 and exists (
    select 1 from public.vehicles
     where user_id = p_user_id and status = 'active' and plan_suspended_at < v_cutoff
  ) then
    select id into v_fee
      from public.billing_purchases
     where user_id = p_user_id and kind = 'restore_fee' and used_at is null and revoked_at is null
     order by created_at
     limit 1
     for update;
    if v_fee is not null then
      with picked as (
        select id from public.vehicles
         where user_id = p_user_id and status = 'active' and plan_suspended_at < v_cutoff
         order by plan_suspended_at desc, created_at
         limit v_room
      )
      update public.vehicles v set plan_suspended_at = null
        from picked where v.id = picked.id;
      get diagnostics v_old = row_count;
      update public.billing_purchases set used_at = now() where id = v_fee;
    end if;
  end if;

  return v_recent + v_old;
end;
$$;

-- 利用者が、再契約や事務手数料の購入のあとに呼ぶ
create or replace function public.restore_suspended_vehicles()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;
  return public.apply_plan_restore(auth.uid());
end;
$$;

-- 解約後、上限を超えているときに残すクルマを1台選ぶ。ほかの（手放していない）クルマは休止にする。休止にした台数を返す
create or replace function public.keep_vehicle(p_vehicle_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_limit integer;
  v_visible integer;
  v_suspended integer;
begin
  if v_user is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles where id = v_user for update;
  perform 1 from public.vehicles
   where id = p_vehicle_id and user_id = v_user and status = 'active' and plan_suspended_at is null;
  if not found then
    raise exception 'vehicle_not_found' using errcode = 'P0001';
  end if;

  v_limit := public.vehicle_limit(public.effective_plan(v_user));
  select count(*) into v_visible
    from public.vehicles
   where user_id = v_user and status = 'active' and plan_suspended_at is null;
  if v_visible <= v_limit then
    return 0;
  end if;
  if v_limit <> 1 then
    raise exception 'keep_not_needed' using errcode = 'P0001';
  end if;

  update public.vehicles
     set plan_suspended_at = now()
   where user_id = v_user and status = 'active' and plan_suspended_at is null and id <> p_vehicle_id;
  get diagnostics v_suspended = row_count;
  return v_suspended;
end;
$$;

-- アプリに出すプランの状態
create or replace function public.plan_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_plan text;
  v_limit integer;
  v_visible integer;
  v_cutoff timestamptz := now() - make_interval(days => public.plan_restore_grace_days());
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;
  v_plan := public.effective_plan(v_user);
  v_limit := public.vehicle_limit(v_plan);
  select count(*) into v_visible
    from public.vehicles
   where user_id = v_user and status = 'active' and plan_suspended_at is null;

  select jsonb_build_object(
    'plan', v_plan,
    'vehicleLimit', v_limit,
    'visibleCount', v_visible,
    'mustChooseVehicle', v_visible > v_limit,
    -- 休止中で、再契約だけで戻せるもの／事務手数料も要るもの
    'suspendedRestorable', (
      select count(*) from public.vehicles
       where user_id = v_user and status = 'active' and plan_suspended_at >= v_cutoff),
    'suspendedNeedsFee', (
      select count(*) from public.vehicles
       where user_id = v_user and status = 'active' and plan_suspended_at < v_cutoff),
    -- 休止中のクルマのうち、事務手数料なしで戻せる期限がいちばん早いもの
    'restoreFreeUntil', (
      select min(plan_suspended_at) + make_interval(days => public.plan_restore_grace_days())
        from public.vehicles
       where user_id = v_user and status = 'active' and plan_suspended_at >= v_cutoff),
    'hasUnusedRestoreFee', exists (
      select 1 from public.billing_purchases
       where user_id = v_user and kind = 'restore_fee' and used_at is null and revoked_at is null),
    'manualPlus', exists (select 1 from public.profiles where id = v_user and plan = 'plus'),
    'subscription', (
      select jsonb_build_object(
        'platform', platform,
        'entitledUntil', entitled_until,
        'autoRenew', auto_renew,
        'active', coalesce(entitled_until > now() and revoked_at is null, false))
        from public.billing_purchases
       where user_id = v_user and kind = 'subscription'
       order by (entitled_until > now() and revoked_at is null) desc nulls last, entitled_until desc nulls last
       limit 1)
  ) into v_result;
  return v_result;
end;
$$;

revoke execute on function public.plan_restore_grace_days() from public, anon;
revoke execute on function public.effective_plan(uuid) from public, anon, authenticated;
revoke execute on function public.apply_plan_restore(uuid) from public, anon, authenticated;
revoke execute on function public.restore_suspended_vehicles() from public, anon;
revoke execute on function public.keep_vehicle(uuid) from public, anon;
revoke execute on function public.plan_status() from public, anon;
grant execute on function public.plan_restore_grace_days() to authenticated, service_role;
grant execute on function public.effective_plan(uuid) to service_role;
grant execute on function public.apply_plan_restore(uuid) to service_role;
grant execute on function public.restore_suspended_vehicles() to authenticated;
grant execute on function public.keep_vehicle(uuid) to authenticated;
grant execute on function public.plan_status() to authenticated;
