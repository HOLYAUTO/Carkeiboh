-- タイヤ・ブレーキの記録と、入力の手間の計測（2026-10-30。docs/open-questions.md 49・50）
--
-- 1) wear_checks：タイヤ・ブレーキを点検・交換した記録。溝・パッドの残り（mm）は任意。
--    利用者が自分で入れる記録と、整備工場が Ledra で作った記録（証明付き）を同じ表に持つ。
--    Ledra から受け取る API はまだ無い（docs/ledra-api-contract.md の 案）。受け取る列だけ先に用意し、
--    オイル交換と同じく、利用者は source = 'ledra' の行を作れない・変えられない。
-- 2) input_sessions：記録画面を開いてから保存・離脱までの時間と、使った入力方法。
--    実証実験の KPI（入力の手間・入力できたか）の計測用。利用者は書き込むだけで、読めない。

-- ---------------------------------------------------------------------------
-- タイヤ・ブレーキの記録
-- ---------------------------------------------------------------------------
create table public.wear_checks (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('tire', 'brake')),
  performed_on date not null,
  odo_km integer check (odo_km between 0 and 2000000),
  -- 交換した（false なら点検・確認だけ）
  replaced boolean not null default false,
  -- いちばん減っているところの残り（タイヤは溝の深さ、ブレーキはパッドの厚さ）。分からなければ空欄
  remaining_mm numeric(3, 1) check (remaining_mm between 0 and 30),
  note text check (note is null or char_length(note) <= 200),
  -- 出どころ：自分で入力 / Ledra（証明付き・編集不可）
  source text not null default 'manual' check (source in ('manual', 'ledra')),
  ledra_link_id uuid references public.ledra_links (id) on delete set null,
  ledra_record_id text,
  shop_name text check (shop_name is null or char_length(shop_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_id, kind, ledra_record_id),
  check ((source = 'ledra') = (ledra_record_id is not null)),
  foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade
);

create index wear_checks_vehicle_idx on public.wear_checks (vehicle_id, performed_on);

create trigger wear_checks_set_updated_at
  before update on public.wear_checks
  for each row execute function public.set_updated_at();

alter table public.wear_checks enable row level security;
revoke all on public.wear_checks from anon;

create policy "wear_checks: 本人のみ参照" on public.wear_checks
  for select to authenticated using (user_id = (select auth.uid()));
create policy "wear_checks: 自分で入力した記録を作成" on public.wear_checks
  for insert to authenticated
  with check (user_id = (select auth.uid()) and source = 'manual' and ledra_link_id is null);
create policy "wear_checks: 自分で入力した記録を編集" on public.wear_checks
  for update to authenticated
  using (user_id = (select auth.uid()) and source = 'manual')
  with check (user_id = (select auth.uid()) and source = 'manual' and ledra_link_id is null);
create policy "wear_checks: 自分で入力した記録を削除" on public.wear_checks
  for delete to authenticated
  using (user_id = (select auth.uid()) and source = 'manual');

-- 手放したクルマ（乗り換え・廃車）には、タイヤ・ブレーキも記録を足せない（20261031000001 の他の記録と同じ）
create trigger wear_checks_ensure_vehicle_active
  before insert or update or delete on public.wear_checks
  for each row execute function public.ensure_vehicle_active();

-- タイヤ・ブレーキの記録は、オイル交換とは別の差分の位置で取り込む（docs/ledra-api-contract.md 5章）
alter table public.ledra_links add column wear_sync_cursor text;

-- 走行距離を入れた記録は、ペースの計算にも使う（列の並びと型は元のビューと同じ）
create or replace view public.odometer_points
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
   where odo_km is not null and oil_change_id is null
  union all
  select vehicle_id, user_id, performed_on, odo_km, 'wear_check'
    from public.wear_checks
   where odo_km is not null;

-- ---------------------------------------------------------------------------
-- 入力の計測（実証実験の KPI 用）
-- ---------------------------------------------------------------------------
create table public.input_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- 本人の車両だけ（下の外部キー）。車両を消しても計測は残す（利用者を消したときは消える）
  vehicle_id uuid,
  -- 記録の項目（「記録する」で選んだもの。oil_change / tire / brake / fuel / odometer など）
  kind text not null check (char_length(kind) <= 30),
  mode text not null check (mode in ('new', 'edit')),
  -- 最後に使った入力の補助。何も使わなければ manual
  method text not null check (method in ('manual', 'photo', 'voice')),
  outcome text not null check (outcome in ('saved', 'abandoned')),
  opened_at timestamptz not null,
  finished_at timestamptz not null,
  -- 写真・音声で埋まった項目の数と、そのうち保存までに利用者が直した数（読み取りの当たり具合）
  draft_fields smallint not null default 0 check (draft_fields between 0 and 20),
  draft_fields_changed smallint not null default 0 check (draft_fields_changed >= 0),
  -- 保存の前に出た確認（走行距離の逆行など）の数
  warnings_shown smallint not null default 0 check (warnings_shown between 0 and 20),
  -- 保存した記録（`oil:<id>` など。離脱したときは空）
  record_ref text check (record_ref is null or char_length(record_ref) <= 80),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  created_at timestamptz not null default now(),
  foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete set null (vehicle_id),
  check (finished_at >= opened_at),
  check (draft_fields_changed <= draft_fields),
  check ((outcome = 'saved') = (record_ref is not null))
);

create index input_sessions_user_idx on public.input_sessions (user_id, opened_at);

alter table public.input_sessions enable row level security;
revoke all on public.input_sessions from anon;

-- 利用者は自分の分を追加するだけ。読み出し・集計はサーバー側（service_role）で行う
create policy "input_sessions: 本人の分を追加" on public.input_sessions
  for insert to authenticated with check (user_id = (select auth.uid()));
revoke select, update, delete on public.input_sessions from authenticated;
