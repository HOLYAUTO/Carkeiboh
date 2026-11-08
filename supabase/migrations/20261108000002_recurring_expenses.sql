-- 毎月・毎年決まって払う支出（保険・ローン・月極駐車場・自動車税など）。2026-11-08 の要望
-- 一度登録すると、その日が来たらホームに「記録する／飛ばす」を出す（勝手に記録はしない）。
-- 記録した・飛ばした回は recurring_expense_occurrences に残し、同じ回を二度出さない

create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category text not null check (category in ('maintenance', 'shaken', 'insurance', 'car_tax', 'parking_toll', 'loan_lease', 'other')),
  -- 金額（税込）。自動車税だけは null にでき、そのときは車検証の内容から計算した税額を使う
  amount_yen integer check (amount_yen is null or amount_yen between 1 and 99999999),
  -- monthly：毎月 day_of_month 日 / yearly：毎年 month_of_year 月 day_of_month 日
  frequency text not null check (frequency in ('monthly', 'yearly')),
  month_of_year smallint check (month_of_year is null or month_of_year between 1 and 12),
  -- 31 などその月に無い日は月末にする
  day_of_month smallint not null check (day_of_month between 1 and 31),
  -- この日以後の回から出す
  starts_on date not null default current_date,
  ends_on date,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((frequency = 'yearly') = (month_of_year is not null)),
  check (amount_yen is not null or category = 'car_tax'),
  check (ends_on is null or ends_on >= starts_on),
  foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade
);

create index recurring_expenses_vehicle_idx on public.recurring_expenses (vehicle_id);

create trigger recurring_expenses_set_updated_at
  before update on public.recurring_expenses
  for each row execute function public.set_updated_at();

create trigger recurring_expenses_ensure_vehicle_active
  before insert or update or delete on public.recurring_expenses
  for each row execute function public.ensure_vehicle_active();

create table public.recurring_expense_occurrences (
  recurring_id uuid not null references public.recurring_expenses (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  due_on date not null,
  status text not null check (status in ('recorded', 'skipped')),
  -- 記録した支出。あとで支出を消しても、この回はもう出さない
  expense_id uuid references public.expenses (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (recurring_id, due_on)
);

alter table public.recurring_expenses enable row level security;
alter table public.recurring_expense_occurrences enable row level security;
revoke all on public.recurring_expenses from anon;
revoke all on public.recurring_expense_occurrences from anon;

create policy "recurring_expenses: 本人のみ" on public.recurring_expenses for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 回の記録は本人の登録にだけ付けられる
create policy "recurring_expense_occurrences: 本人のみ" on public.recurring_expense_occurrences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.recurring_expenses r where r.id = recurring_id and r.user_id = (select auth.uid()))
  );

-- 1回分を「記録する」（支出を作る）か「飛ばす」。支出と回の記録を1つのトランザクションで作り、二重に記録しない。
-- 呼び出した人の権限で動く（RLS がそのまま効く）
create or replace function public.handle_recurring_expense(p_recurring_id uuid, p_due_on date, p_record boolean, p_amount_yen integer default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.recurring_expenses;
  v_expense uuid;
begin
  select * into r from public.recurring_expenses where id = p_recurring_id;
  if not found then
    raise exception 'recurring_not_found' using errcode = 'P0002';
  end if;
  if p_record then
    insert into public.expenses (vehicle_id, spent_on, category, amount_yen, note)
    values (r.vehicle_id, p_due_on, r.category, coalesce(p_amount_yen, r.amount_yen), r.note)
    returning id into v_expense;
  end if;
  insert into public.recurring_expense_occurrences (recurring_id, due_on, status, expense_id)
  values (p_recurring_id, p_due_on, case when p_record then 'recorded' else 'skipped' end, v_expense);
  return v_expense;
end;
$$;

revoke execute on function public.handle_recurring_expense(uuid, date, boolean, integer) from anon, public;
grant execute on function public.handle_recurring_expense(uuid, date, boolean, integer) to authenticated;
