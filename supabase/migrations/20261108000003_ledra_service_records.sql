-- 整備工場（Ledra）から、整備・車検・オイル交換の金額を証明付きで取り込む。2026-11-08 の要望
-- docs/ledra-api-contract.md 6章。取り込んだ支出は source = 'ledra' で、利用者は変えられない（オイル交換・タイヤ・ブレーキと同じ）

alter table public.expenses
  add column source text not null default 'manual' check (source in ('manual', 'ledra')),
  add column ledra_link_id uuid references public.ledra_links (id) on delete set null,
  -- Ledra の記録ID。同じ車両で同じ記録は1件だけ（訂正は上書き）
  add column ledra_record_id text check (ledra_record_id is null or char_length(ledra_record_id) <= 200),
  add constraint expenses_ledra_record_unique unique (vehicle_id, ledra_record_id),
  add constraint expenses_ledra_source check ((source = 'ledra') = (ledra_record_id is not null));

alter table public.ledra_links
  add column service_sync_cursor text;

-- 本人の支出を読み書きできるが、Ledra から来た支出は読むだけ（作成・変更・削除はサーバーだけ）
drop policy "expenses: 本人のみ" on public.expenses;

create policy "expenses: 本人のみ参照" on public.expenses
  for select to authenticated using (user_id = (select auth.uid()));
create policy "expenses: 自分で入力した支出を作成" on public.expenses
  for insert to authenticated
  with check (user_id = (select auth.uid()) and source = 'manual' and ledra_link_id is null and ledra_record_id is null);
create policy "expenses: 自分で入力した支出を編集" on public.expenses
  for update to authenticated
  using (user_id = (select auth.uid()) and source = 'manual')
  with check (user_id = (select auth.uid()) and source = 'manual' and ledra_link_id is null and ledra_record_id is null);
create policy "expenses: 自分で入力した支出を削除" on public.expenses
  for delete to authenticated
  using (user_id = (select auth.uid()) and source = 'manual');
