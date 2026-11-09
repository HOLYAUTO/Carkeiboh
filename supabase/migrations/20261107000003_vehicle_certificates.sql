-- 車検証（自動車検査証）の記載内容をすべて記録する。2026-11-07 の要望
-- - 税の計算に使う項目（用途・自家用/事業用・乗車定員・最大積載量・車両総重量）は vehicles に持つ
--   （種別・総排気量・初度登録年月・燃料・車両重量は 20261107000002 で追加済み）
-- - それ以外の記載内容は vehicle_certificates に1台1行で持つ。所有者・使用者の氏名・住所、使用の本拠の位置は
--   個人情報なので、アプリでは伏せて表示する（supabase/functions/_shared/domain/vehicle-certificate.ts）
-- - 写真から読み取る（read-vehicle-certificate）。写真は保存しない

alter table public.vehicles
  -- 用途：passenger=乗用 / cargo=貨物 / bus=乗合 / special=特種
  add column usage text check (usage is null or usage in ('passenger', 'cargo', 'bus', 'special')),
  -- 自家用・事業用の別：private=自家用 / commercial=事業用（営業用）
  add column business_class text check (business_class is null or business_class in ('private', 'commercial')),
  add column seating_capacity smallint check (seating_capacity is null or seating_capacity between 1 and 100),
  -- 最大積載量（kg）。貨物車の自動車税に使う
  add column max_load_kg integer check (max_load_kg is null or max_load_kg between 0 and 100000),
  -- 車両総重量（kg）。貨物車の重量税に使う
  add column gross_weight_kg integer check (gross_weight_kg is null or gross_weight_kg between 1 and 100000);

create table public.vehicle_certificates (
  vehicle_id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- 自動車登録番号（軽は車両番号）。例：品川 300 あ 12-34
  registration_number text check (registration_number is null or char_length(registration_number) <= 40),
  -- 登録年月日（交付年月日）
  registered_on date,
  -- 有効期間の満了する日
  expires_on date,
  -- 自動車の種別（普通・小型・軽・大型特殊・小型特殊）。車検証の文言のまま
  kind_text text check (kind_text is null or char_length(kind_text) <= 20),
  -- 車体の形状（箱型・ステーションワゴン・バンなど）
  body_shape text check (body_shape is null or char_length(body_shape) <= 40),
  -- 車名（メーカー）
  maker text check (maker is null or char_length(maker) <= 40),
  -- 型式
  model_code text check (model_code is null or char_length(model_code) <= 40),
  -- 車台番号
  chassis_number text check (chassis_number is null or char_length(chassis_number) <= 40),
  -- 原動機の型式
  engine_model text check (engine_model is null or char_length(engine_model) <= 40),
  length_cm integer check (length_cm is null or length_cm between 1 and 5000),
  width_cm integer check (width_cm is null or width_cm between 1 and 1000),
  height_cm integer check (height_cm is null or height_cm between 1 and 1000),
  -- 軸重（前前・前後・後前・後後、kg）
  axle_ff_kg integer check (axle_ff_kg is null or axle_ff_kg between 0 and 100000),
  axle_fr_kg integer check (axle_fr_kg is null or axle_fr_kg between 0 and 100000),
  axle_rf_kg integer check (axle_rf_kg is null or axle_rf_kg between 0 and 100000),
  axle_rr_kg integer check (axle_rr_kg is null or axle_rr_kg between 0 and 100000),
  -- 型式指定番号・類別区分番号
  type_designation_number text check (type_designation_number is null or char_length(type_designation_number) <= 20),
  category_number text check (category_number is null or char_length(category_number) <= 20),
  -- 個人情報（アプリでは伏せて表示する）
  owner_name text check (owner_name is null or char_length(owner_name) <= 100),
  owner_address text check (owner_address is null or char_length(owner_address) <= 200),
  user_name text check (user_name is null or char_length(user_name) <= 100),
  user_address text check (user_address is null or char_length(user_address) <= 200),
  -- 使用の本拠の位置
  base_location text check (base_location is null or char_length(base_location) <= 200),
  -- 備考
  remarks text check (remarks is null or char_length(remarks) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade
);

create trigger vehicle_certificates_set_updated_at
  before update on public.vehicle_certificates
  for each row execute function public.set_updated_at();

alter table public.vehicle_certificates enable row level security;
revoke all on public.vehicle_certificates from anon;

create policy "vehicle_certificates: 本人のみ" on public.vehicle_certificates for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 手放したクルマの車検証は変えられない（記録と同じ）
create trigger vehicle_certificates_ensure_vehicle_active
  before insert or update or delete on public.vehicle_certificates
  for each row execute function public.ensure_vehicle_active();

-- 通知の定期実行が読むビューにも新しい列を出す（v.* は作成したときの列で固定されるため作り直す）
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
