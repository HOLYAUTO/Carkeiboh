-- ガソリンスタンドの場所の控え（OpenStreetMap の amenity=fuel を、約5km四方の区画ごとに保存）。2026-11-08 の要望
-- スタンドに来たら給油の記録を勧めるために使う。区画だけを受け取り、利用者の正確な位置は受け取らない。
-- Overpass API に何度も問い合わせないよう、区画ごとに30日間ためる（fuel-stations の Edge Function だけが読み書きする）

create table public.fuel_station_tiles (
  -- 区画の名前（例：'694_2709'。0.05度ごとの番号）
  tile text primary key check (tile ~ '^-?\d{1,4}_-?\d{1,4}$'),
  -- [{ id, name, latitude, longitude }]
  stations jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

-- 利用者には読ませない（サーバーの service role だけが使う）
alter table public.fuel_station_tiles enable row level security;
revoke all on public.fuel_station_tiles from anon, authenticated;
