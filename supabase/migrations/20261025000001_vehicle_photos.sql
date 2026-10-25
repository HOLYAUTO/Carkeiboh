-- 愛車の写真（ホームの一番上に出す）
-- 方針：
--   * 写真は非公開のバケット vehicle-photos に「<利用者ID>/<車両ID>-<時刻>.jpg」で置き、本人だけが読み書きできる
--   * 表示は期限付きの URL で行う。差し替えるたびにファイル名を変え、古い写真が表示に残らないようにする

alter table public.vehicles
  add column photo_path text check (photo_path is null or char_length(photo_path) <= 200),
  add column photo_updated_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-photos', 'vehicle-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- 1つ目のフォルダが本人の利用者ID のものだけを扱える
create policy "vehicle-photos: 本人のみ参照" on storage.objects
  for select to authenticated
  using (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "vehicle-photos: 本人のみ追加" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "vehicle-photos: 本人のみ更新" on storage.objects
  for update to authenticated
  using (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "vehicle-photos: 本人のみ削除" on storage.objects
  for delete to authenticated
  using (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
