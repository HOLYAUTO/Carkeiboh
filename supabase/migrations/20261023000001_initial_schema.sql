-- カーケイボー初期スキーマ
-- 方針：
--   * すべての利用者データに user_id を持たせ、行単位のアクセス制御（RLS）で本人だけに見せる
--   * 車両の子テーブルは (vehicle_id, user_id) の複合外部キーで、他人の車両に記録を付けられないようにする
--   * データ構造は複数台を持てる形にし、台数の上限はプランで制御する（初期版は1台）
--   * auth.users の削除（アカウント削除）で、すべてのデータが連鎖して消える

-- ---------------------------------------------------------------------------
-- 共通
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- プロフィール（プラン）
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- プランごとの車両台数の上限。有料プランを足すときはここを変える
create or replace function public.vehicle_limit(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan when 'free' then 1 else 1 end;
$$;

-- ---------------------------------------------------------------------------
-- 車両
-- ---------------------------------------------------------------------------
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  plate_number text check (plate_number is null or char_length(plate_number) <= 30),
  -- 初回設定の年間走行距離の目安（ODO記録が2件未満のときのペース計算に使う）
  annual_km_estimate integer not null check (annual_km_estimate between 0 and 200000),
  oil_interval_km integer check (oil_interval_km between 500 and 50000),
  oil_interval_months smallint check (oil_interval_months between 1 and 36),
  filter_interval_km integer default 10000 check (filter_interval_km between 500 and 100000),
  filter_interval_months smallint check (filter_interval_months between 1 and 60),
  notify_oil boolean not null default true,
  notify_filter boolean not null default true,
  notify_shaken boolean not null default true,
  notify_inspection boolean not null default true,
  notify_insurance boolean not null default true,
  notify_car_tax boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (oil_interval_km is not null or oil_interval_months is not null),
  check (filter_interval_km is not null or filter_interval_months is not null)
);

create index vehicles_user_id_idx on public.vehicles (user_id);

create trigger vehicles_set_updated_at
  before update on public.vehicles
  for each row execute function public.set_updated_at();

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
  select plan into v_plan from public.profiles where id = new.user_id;
  select count(*) into v_count from public.vehicles where user_id = new.user_id;
  if v_count >= public.vehicle_limit(coalesce(v_plan, 'free')) then
    raise exception 'vehicle_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger vehicles_enforce_limit
  before insert on public.vehicles
  for each row execute function public.enforce_vehicle_limit();

-- ---------------------------------------------------------------------------
-- ODO
-- ---------------------------------------------------------------------------
create table public.odometer_readings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  read_on date not null,
  odo_km integer not null check (odo_km between 0 and 2000000),
  source text not null default 'manual' check (source in ('manual', 'onboarding')),
  created_at timestamptz not null default now(),
  foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade
);

create index odometer_readings_vehicle_idx on public.odometer_readings (vehicle_id, read_on);

-- メーター交換の訂正履歴（交換後の読みに odo_before_km - odo_after_km を足して実走行距離に揃える）
create table public.meter_replacements (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  replaced_on date not null,
  odo_before_km integer not null check (odo_before_km between 0 and 2000000),
  odo_after_km integer not null check (odo_after_km between 0 and 2000000),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade
);

create index meter_replacements_vehicle_idx on public.meter_replacements (vehicle_id, replaced_on);

-- ---------------------------------------------------------------------------
-- Ledra 連携（書き込みはサーバー（service_role）だけ）
-- ---------------------------------------------------------------------------
create table public.ledra_links (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Ledra 側が発行した連携ID
  ledra_link_id text not null unique,
  status text not null default 'active'
    check (status in ('active', 'revoked_by_user', 'revoked_by_provider')),
  -- 同意画面に表示した内容の控え（提供元・提供先・受け取る項目・解除方法・文面の版）
  consent jsonb not null,
  consented_at timestamptz not null,
  sync_cursor text,
  last_synced_at timestamptz,
  last_error text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade
);

create unique index ledra_links_one_active_per_vehicle
  on public.ledra_links (vehicle_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- オイル交換の記録
-- ---------------------------------------------------------------------------
create table public.oil_changes (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  performed_on date not null,
  odo_km integer not null check (odo_km between 0 and 2000000),
  oil_changed boolean not null default true,
  filter_changed boolean not null default false,
  -- 出どころ：自分で入力 / Ledra（証明付き・編集不可）
  source text not null default 'manual' check (source in ('manual', 'ledra')),
  ledra_link_id uuid references public.ledra_links (id) on delete set null,
  ledra_record_id text,
  shop_name text check (shop_name is null or char_length(shop_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, vehicle_id),
  unique (vehicle_id, ledra_record_id),
  check (oil_changed or filter_changed),
  check ((source = 'ledra') = (ledra_record_id is not null)),
  foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade
);

create index oil_changes_vehicle_idx on public.oil_changes (vehicle_id, performed_on);

create trigger oil_changes_set_updated_at
  before update on public.oil_changes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 維持費
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  spent_on date not null,
  category text not null check (category in (
    'oil_change', 'fuel', 'maintenance', 'shaken', 'insurance',
    'car_tax', 'parking_toll', 'loan_lease', 'other'
  )),
  amount_yen integer not null check (amount_yen between 1 and 99999999),
  odo_km integer check (odo_km between 0 and 2000000),
  -- オイル交換の金額は、その記録に紐づく支出1件として持つ（二重計上を防ぐ）。
  -- Ledra から来た記録にも、利用者が金額だけを後から追記できる
  oil_change_id uuid unique,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((category = 'oil_change') = (oil_change_id is not null)),
  foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade,
  foreign key (oil_change_id, vehicle_id) references public.oil_changes (id, vehicle_id) on delete cascade
);

create index expenses_vehicle_idx on public.expenses (vehicle_id, spent_on);

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 期限（車検・定期点検・自動車保険）
-- 更新を登録したら旧い期限は superseded にし、通知を止める
-- ---------------------------------------------------------------------------
create table public.deadlines (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('shaken', 'inspection_legal', 'inspection_voluntary', 'insurance')),
  due_on date not null,
  status text not null default 'active' check (status in ('active', 'superseded')),
  created_at timestamptz not null default now(),
  foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade
);

create unique index deadlines_one_active_per_kind
  on public.deadlines (vehicle_id, kind) where status = 'active';

-- 期限の登録・更新。有効な旧い期限を superseded にしてから新しい期限を入れる（RLS は呼び出し元の権限で効く）
create or replace function public.register_deadline(p_vehicle_id uuid, p_kind text, p_due_on date)
returns public.deadlines
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.deadlines;
begin
  update public.deadlines
     set status = 'superseded'
   where vehicle_id = p_vehicle_id and kind = p_kind and status = 'active';
  insert into public.deadlines (vehicle_id, kind, due_on)
  values (p_vehicle_id, p_kind, p_due_on)
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 通知
-- ---------------------------------------------------------------------------
create table public.push_tokens (
  token text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

-- 端末のトークンを今のアカウントに付け替える（同じ端末で別アカウントにログインし直した場合）
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  insert into public.push_tokens (token, user_id, platform)
  values (p_token, auth.uid(), p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

-- 送信済みの記録（同じ段階の通知を二度送らないため）。書き込みはサーバーだけ
create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  title text not null,
  body text not null,
  sent_at timestamptz not null default now(),
  unique (vehicle_id, key),
  foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade
);

create index notification_log_user_idx on public.notification_log (user_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- ODO の点（予測・集計に使う。RLS は元テーブルのものが呼び出し元の権限で効く）
-- ---------------------------------------------------------------------------
create view public.odometer_points
with (security_invoker = true)
as
  select vehicle_id, user_id, read_on as date, odo_km, 'reading'::text as source
    from public.odometer_readings
  union all
  select vehicle_id, user_id, performed_on, odo_km, 'oil_change'
    from public.oil_changes
  union all
  select vehicle_id, user_id, spent_on, odo_km, 'expense'
    from public.expenses
   where odo_km is not null and oil_change_id is null;

-- ---------------------------------------------------------------------------
-- 行単位のアクセス制御
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.odometer_readings enable row level security;
alter table public.meter_replacements enable row level security;
alter table public.ledra_links enable row level security;
alter table public.oil_changes enable row level security;
alter table public.expenses enable row level security;
alter table public.deadlines enable row level security;
alter table public.push_tokens enable row level security;
alter table public.notification_log enable row level security;

-- 未ログイン（anon）には何も見せない
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.register_deadline(uuid, text, date) to authenticated;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.vehicle_limit(text) to authenticated;

create policy "profiles: 本人のみ参照" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

-- 本人の行だけを読み書きできる標準のポリシー
do $$
declare
  t text;
begin
  foreach t in array array['vehicles', 'odometer_readings', 'meter_replacements', 'expenses', 'deadlines', 'push_tokens']
  loop
    execute format(
      'create policy "%1$s: 本人のみ" on public.%1$I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- オイル交換：Ledra から来た記録は参照のみ（作成・編集・削除はサーバーだけ）
create policy "oil_changes: 本人のみ参照" on public.oil_changes
  for select to authenticated using (user_id = (select auth.uid()));
create policy "oil_changes: 自分で入力した記録を作成" on public.oil_changes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and source = 'manual' and ledra_link_id is null);
create policy "oil_changes: 自分で入力した記録を編集" on public.oil_changes
  for update to authenticated
  using (user_id = (select auth.uid()) and source = 'manual')
  with check (user_id = (select auth.uid()) and source = 'manual' and ledra_link_id is null);
create policy "oil_changes: 自分で入力した記録を削除" on public.oil_changes
  for delete to authenticated
  using (user_id = (select auth.uid()) and source = 'manual');

-- Ledra 連携と送信済み通知は参照のみ
create policy "ledra_links: 本人のみ参照" on public.ledra_links
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notification_log: 本人のみ参照" on public.notification_log
  for select to authenticated using (user_id = (select auth.uid()));

-- Ledra から来た記録の本体を書き換えられないよう、列の権限でも絞る
revoke insert, update, delete on public.ledra_links from authenticated;
revoke insert, update, delete on public.notification_log from authenticated;
