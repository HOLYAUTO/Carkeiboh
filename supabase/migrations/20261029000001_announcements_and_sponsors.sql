-- お知らせ（アップデート・修正のお知らせ／たにぐち自動車の最新情報）と、スポンサー広告枠
-- 方針：
--   * お知らせと広告は、運営スタッフ（HOLY・たにぐち自動車）がアプリの「運営メニュー」から登録する。
--     スタッフの登録・解除は SQL（service_role）だけが行う（docs/setup.md 7章）
--   * アップデート・修正のお知らせは HOLY が出す。たにぐち自動車の最新情報はたにぐち自動車が出す
--     （HOLY は開発・管理の委託先として、最新情報も代わりに出せる）
--   * たにぐち自動車の最新情報は、利用者が「受け取る」を選んだときだけホームに出し、プッシュ通知を送る（既定は受け取らない）
--   * 広告は Google などの外部の広告サービスを使わず、自前の枠に載せる。各社は自社が管理する広告だけを編集でき、
--     HOLY はすべてを編集できる。表示・タップの記録は利用者が書き込むだけで、集計はスタッフが関数で読む

-- ---------------------------------------------------------------------------
-- 運営スタッフ
-- ---------------------------------------------------------------------------
create table public.staff_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  org text not null check (org in ('holy', 'taniguchi')),
  display_name text check (display_name is null or char_length(display_name) <= 50),
  created_at timestamptz not null default now()
);

alter table public.staff_members enable row level security;
revoke all on public.staff_members from anon;
revoke insert, update, delete on public.staff_members from authenticated;

create policy "staff_members: 本人のみ参照" on public.staff_members
  for select to authenticated using (user_id = (select auth.uid()));

-- 呼び出した利用者の所属（スタッフでなければ null）。ポリシーの中で使うため security definer にする
create or replace function public.staff_org()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select org from public.staff_members where user_id = auth.uid();
$$;

revoke execute on function public.staff_org() from public, anon;
grant execute on function public.staff_org() to authenticated;

-- ---------------------------------------------------------------------------
-- お知らせ
-- ---------------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  -- app_update：アップデート・修正のお知らせ（HOLY）／shop_news：たにぐち自動車の最新情報
  category text not null check (category in ('app_update', 'shop_news')),
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 2000),
  link_url text check (link_url is null or link_url ~ '^https://'),
  link_label text check (link_label is null or char_length(link_label) between 1 and 30),
  -- 下書きのあいだは false。公開日時を先にしておけば、その時刻から表示する（予約）
  is_published boolean not null default false,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  -- 公開と同時にプッシュ通知を送るか。送った時刻はサーバー（announce-dispatch）だけが書く
  send_push boolean not null default false,
  pushed_at timestamptz,
  org text not null default public.staff_org() check (org in ('holy', 'taniguchi')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > published_at)
);

create index announcements_published_idx on public.announcements (published_at desc);
create index announcements_push_idx on public.announcements (published_at) where send_push and pushed_at is null;

create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

alter table public.announcements enable row level security;
revoke all on public.announcements from anon;
-- 送信の記録（pushed_at）・書いた会社（org）・作成者は、スタッフからも書き換えられないよう列で絞る
revoke insert, update on public.announcements from authenticated;
grant insert (category, title, body, link_url, link_label, is_published, published_at, expires_at, send_push)
  on public.announcements to authenticated;
grant update (category, title, body, link_url, link_label, is_published, published_at, expires_at, send_push)
  on public.announcements to authenticated;

-- その会社が扱える種類か（HOLY は両方、たにぐち自動車は最新情報だけ）
create or replace function public.can_manage_announcement(p_category text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select org = 'holy' or (org = 'taniguchi' and p_category = 'shop_news')
       from public.staff_members where user_id = auth.uid()),
    false);
$$;

revoke execute on function public.can_manage_announcement(text) from public, anon;
grant execute on function public.can_manage_announcement(text) to authenticated;

create policy "announcements: 公開中のお知らせを参照" on public.announcements
  for select to authenticated
  using (is_published and published_at <= now() and (expires_at is null or expires_at > now()));
create policy "announcements: スタッフは下書きも参照" on public.announcements
  for select to authenticated
  using (public.staff_org() is not null);
create policy "announcements: スタッフが作成" on public.announcements
  for insert to authenticated
  with check (public.can_manage_announcement(category) and created_by = (select auth.uid()));
create policy "announcements: スタッフが編集" on public.announcements
  for update to authenticated
  using (public.can_manage_announcement(category))
  with check (public.can_manage_announcement(category));
create policy "announcements: スタッフが削除" on public.announcements
  for delete to authenticated
  using (public.can_manage_announcement(category));

-- ---------------------------------------------------------------------------
-- 利用者ごとの受け取りの設定・既読
-- ---------------------------------------------------------------------------
alter table public.profiles
  -- たにぐち自動車の最新情報を受け取るか（null＝まだ選んでいない。ホームで一度だけ案内する）
  add column shop_news_opt_in boolean,
  -- 最後に選んだ日時（受け取ると選んだことの控え）
  add column shop_news_opt_in_at timestamptz,
  -- お知らせの一覧を最後に開いた日時。これより後に公開されたお知らせを「未読」にする
  add column announcements_seen_at timestamptz;

-- プロフィールの行はプランを含むため、利用者には直接書かせず、決まった列だけを関数で変える
create or replace function public.set_shop_news_opt_in(p_opt_in boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  update public.profiles
     set shop_news_opt_in = p_opt_in, shop_news_opt_in_at = now()
   where id = auth.uid();
end;
$$;

create or replace function public.mark_announcements_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  update public.profiles set announcements_seen_at = now() where id = auth.uid();
end;
$$;

revoke execute on function public.set_shop_news_opt_in(boolean) from public, anon;
revoke execute on function public.mark_announcements_seen() from public, anon;
grant execute on function public.set_shop_news_opt_in(boolean) to authenticated;
grant execute on function public.mark_announcements_seen() to authenticated;

-- プッシュ通知の送り先（announce-dispatch から service_role で呼ぶ）。最新情報は受け取ると選んだ利用者だけ
create or replace function public.announcement_push_tokens(p_category text, p_after text, p_limit integer)
returns table (token text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.token
    from public.push_tokens t
    join public.profiles p on p.id = t.user_id
   where (p_category = 'app_update' or (p_category = 'shop_news' and p.shop_news_opt_in))
     and (p_after is null or t.token > p_after)
   order by t.token
   limit p_limit;
$$;

revoke execute on function public.announcement_push_tokens(text, text, integer) from public, anon, authenticated;
grant execute on function public.announcement_push_tokens(text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- スポンサー広告枠
-- ---------------------------------------------------------------------------
create table public.sponsor_ads (
  id uuid primary key default gen_random_uuid(),
  -- 管理する会社（広告主との契約の窓口）
  org text not null default public.staff_org() check (org in ('holy', 'taniguchi')),
  -- 広告主の名前。枠に「PR・<広告主>」と出す
  sponsor_name text not null check (char_length(sponsor_name) between 1 and 60),
  title text not null check (char_length(title) between 1 and 40),
  body text check (body is null or char_length(body) <= 120),
  -- 公開バケット sponsor-images の中の場所
  image_path text check (image_path is null or char_length(image_path) <= 200),
  link_url text check (link_url is null or link_url ~ '^https://'),
  -- 出す場所：home（ホーム）／costs（維持費）／shops（整備工場）
  placements text[] not null default '{home}'
    check (cardinality(placements) > 0 and placements <@ array['home', 'costs', 'shops']),
  is_published boolean not null default false,
  starts_on date not null default ((now() at time zone 'Asia/Tokyo')::date),
  ends_on date,
  -- 同じ場所に複数あるときの出しやすさ（大きいほど多く出る）
  weight smallint not null default 1 check (weight between 1 and 100),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);

create trigger sponsor_ads_set_updated_at
  before update on public.sponsor_ads
  for each row execute function public.set_updated_at();

-- 表示・タップの記録（広告主への報告と、掲載料の根拠に使う）
create table public.sponsor_ad_events (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.sponsor_ads (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  action text not null check (action in ('impression', 'click')),
  placement text not null check (placement in ('home', 'costs', 'shops')),
  created_at timestamptz not null default now()
);

create index sponsor_ad_events_ad_idx on public.sponsor_ad_events (ad_id, created_at);

alter table public.sponsor_ads enable row level security;
alter table public.sponsor_ad_events enable row level security;

revoke all on public.sponsor_ads, public.sponsor_ad_events from anon;
revoke insert, update on public.sponsor_ads from authenticated;
grant insert (org, sponsor_name, title, body, image_path, link_url, placements, is_published, starts_on, ends_on, weight)
  on public.sponsor_ads to authenticated;
grant update (org, sponsor_name, title, body, image_path, link_url, placements, is_published, starts_on, ends_on, weight)
  on public.sponsor_ads to authenticated;
revoke select, update, delete on public.sponsor_ad_events from authenticated;

-- 自社の広告か（HOLY はすべて）
create or replace function public.can_manage_sponsor(p_org text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select org = 'holy' or org = p_org from public.staff_members where user_id = auth.uid()),
    false);
$$;

revoke execute on function public.can_manage_sponsor(text) from public, anon;
grant execute on function public.can_manage_sponsor(text) to authenticated;

create policy "sponsor_ads: 掲載中の広告を参照" on public.sponsor_ads
  for select to authenticated
  using (
    is_published
    and starts_on <= (now() at time zone 'Asia/Tokyo')::date
    and (ends_on is null or ends_on >= (now() at time zone 'Asia/Tokyo')::date)
  );
-- 広告枠の空き具合を両社で確かめられるよう、スタッフは他社の広告（下書きを含む）も参照できる
create policy "sponsor_ads: スタッフは下書きも参照" on public.sponsor_ads
  for select to authenticated
  using (public.staff_org() is not null);
create policy "sponsor_ads: スタッフが作成" on public.sponsor_ads
  for insert to authenticated
  with check (public.can_manage_sponsor(org) and created_by = (select auth.uid()));
create policy "sponsor_ads: スタッフが自社の広告を編集" on public.sponsor_ads
  for update to authenticated
  using (public.can_manage_sponsor(org))
  with check (public.can_manage_sponsor(org));
create policy "sponsor_ads: スタッフが自社の広告を削除" on public.sponsor_ads
  for delete to authenticated
  using (public.can_manage_sponsor(org));

-- 掲載中の広告に対してだけ、本人の記録を書き込める（下書きをスタッフが確かめた分は記録しない）
create policy "sponsor_ad_events: 本人が掲載中の広告に記録" on public.sponsor_ad_events
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sponsor_ads a
       where a.id = ad_id
         and a.is_published
         and placement = any (a.placements)
         and a.starts_on <= (now() at time zone 'Asia/Tokyo')::date
         and (a.ends_on is null or a.ends_on >= (now() at time zone 'Asia/Tokyo')::date)
    )
  );

-- 期間（日本時間の日付、両端を含む）の表示・タップの数。スタッフが自社の広告（HOLY はすべて）の分だけ読める
create or replace function public.sponsor_ad_stats(p_from date, p_to date)
returns table (ad_id uuid, impressions bigint, clicks bigint, users bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.staff_org() is null then
    raise exception 'not_staff' using errcode = '42501';
  end if;
  return query
    select e.ad_id,
           count(*) filter (where e.action = 'impression'),
           count(*) filter (where e.action = 'click'),
           count(distinct e.user_id)
      from public.sponsor_ad_events e
      join public.sponsor_ads a on a.id = e.ad_id
     where public.can_manage_sponsor(a.org)
       and e.created_at >= (p_from::timestamp at time zone 'Asia/Tokyo')
       and e.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Tokyo')
     group by e.ad_id;
end;
$$;

revoke execute on function public.sponsor_ad_stats(date, date) from public, anon;
grant execute on function public.sponsor_ad_stats(date, date) to authenticated;

-- 広告の画像。誰でも URL で見られる公開バケットに置き、追加・差し替え・削除はスタッフだけ
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-images', 'sponsor-images', true, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create policy "sponsor-images: スタッフが参照" on storage.objects
  for select to authenticated
  using (bucket_id = 'sponsor-images' and public.staff_org() is not null);
create policy "sponsor-images: スタッフが追加" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'sponsor-images' and public.staff_org() is not null);
create policy "sponsor-images: スタッフが削除" on storage.objects
  for delete to authenticated
  using (bucket_id = 'sponsor-images' and public.staff_org() is not null);
