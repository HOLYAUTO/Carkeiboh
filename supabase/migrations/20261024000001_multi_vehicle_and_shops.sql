-- 複数台管理（2台目から有料）と、近くの整備工場の掲載（送客）
-- 方針：
--   * プランの変更はサーバー（課金の確認後に service_role）だけが行う。利用者は自分のプランを読めるだけ
--   * 整備工場は掲載料をいただいている店舗だけを、掲載期間中に限りログイン中の利用者へ見せる
--   * 送客の記録（ルート検索・電話など）は利用者が書き込むだけで、読めるのはサーバーだけ（掲載店への報告に使う）

-- ---------------------------------------------------------------------------
-- 複数台プラン
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('free', 'plus'));

-- 無料は1台、複数台プラン（plus）は仮に5台まで（docs/open-questions.md）
create or replace function public.vehicle_limit(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan when 'plus' then 5 else 1 end;
$$;

-- 同時に2台を登録して上限を超えないよう、プロフィールの行をロックしてから数える
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
  select count(*) into v_count from public.vehicles where user_id = new.user_id;
  if v_count >= public.vehicle_limit(coalesce(v_plan, 'free')) then
    raise exception 'vehicle_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 整備工場（掲載店）
-- ---------------------------------------------------------------------------
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  address text not null check (char_length(address) between 1 and 200),
  phone text check (phone is null or phone ~ '^[0-9+\-() ]{6,20}$'),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  business_hours text check (business_hours is null or char_length(business_hours) <= 200),
  description text check (description is null or char_length(description) <= 500),
  website_url text check (website_url is null or website_url ~ '^https://'),
  -- 対応できる作業（例：オイル交換、車検、板金）。一覧の小さなラベルに出す
  services text[] not null default '{}',
  -- 掲載の状態。契約中でも一時的に止められるよう、公開の切り替えと期間を分けて持つ
  is_published boolean not null default false,
  listing_starts_on date not null default ((now() at time zone 'Asia/Tokyo')::date),
  listing_ends_on date,
  -- 同じ距離なら大きいほど上に出す（自社店舗を先頭に出すときなど）
  display_priority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (listing_ends_on is null or listing_ends_on >= listing_starts_on)
);

create trigger shops_set_updated_at
  before update on public.shops
  for each row execute function public.set_updated_at();

-- 送客の記録（掲載店への報告と、掲載料の根拠に使う）
create table public.shop_referrals (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  action text not null check (action in ('view', 'route', 'call', 'website')),
  created_at timestamptz not null default now()
);

create index shop_referrals_shop_idx on public.shop_referrals (shop_id, created_at);

alter table public.shops enable row level security;
alter table public.shop_referrals enable row level security;

revoke all on public.shops, public.shop_referrals from anon;
revoke insert, update, delete on public.shops from authenticated;
revoke select, update, delete on public.shop_referrals from authenticated;

create policy "shops: 掲載中の店舗だけ参照" on public.shops
  for select to authenticated
  using (
    is_published
    and listing_starts_on <= (now() at time zone 'Asia/Tokyo')::date
    and (listing_ends_on is null or listing_ends_on >= (now() at time zone 'Asia/Tokyo')::date)
  );

-- 掲載中の店舗に対してだけ、本人の送客記録を書き込める（店舗の可否は shops の RLS で判定される）
create policy "shop_referrals: 本人が掲載中の店舗に記録" on public.shop_referrals
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.shops s where s.id = shop_id)
  );
