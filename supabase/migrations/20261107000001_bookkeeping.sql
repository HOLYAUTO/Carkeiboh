-- 確定申告・帳簿づけのための列。2026-11-07 の要望
-- - かけ（後払い・請求書払い）の支出は税抜の金額で入れ、アプリが消費税を足して税込にする（amount_yen は今までどおり税込）
-- - 消費税のかからない分（車検の法定費用など）を分けて持つ
-- - 車両ごとの「仕事で使う割合」（家事按分）で、経費にする額を出す
-- 計算は supabase/functions/_shared/domain/bookkeeping.ts

alter table public.vehicles
  -- 仕事で使う割合（%）。未設定は確定申告のまとめで 100% として扱う
  add column business_use_percent smallint check (business_use_percent is null or business_use_percent between 0 and 100);

alter table public.expenses
  -- かけ（後払い）か
  add column on_account boolean not null default false,
  -- かけのとき、利用者が入れた税抜の金額（給油は給油量×単価なので使わない）
  add column entered_amount_yen integer check (entered_amount_yen is null or entered_amount_yen between 1 and 99999999),
  -- 消費税のかからない分（車検の重量税・自賠責保険料・印紙代など）
  add column exempt_yen integer check (exempt_yen is null or exempt_yen >= 0),
  add constraint expenses_entered_amount_on_account check (
    entered_amount_yen is null or (on_account and category <> 'fuel' and entered_amount_yen <= amount_yen)
  ),
  add constraint expenses_exempt_within_amount check (exempt_yen is null or exempt_yen <= amount_yen);

-- 通知の定期実行が読むビューにも business_use_percent を出す（v.* は作成したときの列で固定されるため作り直す。
-- 列を末尾に足すだけなので create or replace でき、権限はそのまま残る）
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
