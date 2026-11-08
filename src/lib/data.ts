/**
 * 画面から使うデータの読み書き。読み取りは react-query でまとめ、書き込み後に再取得する。
 * RLS により、ここで読めるのは本人のデータだけ。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toJstDate, type IsoDate } from '@domain/dates.ts';
import type { ExpenseCategory } from '@domain/costs.ts';
import type { FuelFill, FuelPriceBasis, FuelType } from '@domain/fuel.ts';
import type { DistanceUnit } from '@domain/units.ts';
import type { BookkeepingExpense } from '@domain/bookkeeping.ts';
import { EMPTY_CERTIFICATE, type VehicleCertificate } from '@domain/vehicle-certificate.ts';
import type { DeadlineKind } from '@domain/reminders.ts';
import { buildVehicleState, type VehicleState } from '@domain/vehicle.ts';
import {
  toVehicleData,
  type DeadlineRow,
  type MeterReplacementRow,
  type OdometerPointRow,
  type OilChangeRow,
  type VehicleRow,
} from '@shared/db-mapping.ts';
import { useAuth } from './auth';
import { invokeFunction, supabase } from './supabase';

export type { VehicleRow, OilChangeRow, DeadlineRow, MeterReplacementRow, OdometerPointRow };

export interface ExpenseRow {
  id: string;
  vehicle_id: string;
  spent_on: IsoDate;
  category: ExpenseCategory;
  amount_yen: number;
  odo_km: number | null;
  oil_change_id: string | null;
  note: string | null;
  /** 給油の詳細（給油のときだけ）。Postgres の numeric は文字列で届く */
  fuel_liters: string | number | null;
  fuel_unit_price: string | number | null;
  fuel_type: FuelType | null;
  fuel_price_basis: FuelPriceBasis | null;
  fuel_full_tank: boolean | null;
  /** かけ（後払い）か。かけのときは税抜の金額（entered_amount_yen）から税込（amount_yen）を出す */
  on_account: boolean;
  entered_amount_yen: number | null;
  /** 消費税のかからない分（車検の法定費用など） */
  exempt_yen: number | null;
  created_at: string;
}

export interface OdometerReadingRow {
  id: string;
  vehicle_id: string;
  read_on: IsoDate;
  odo_km: number;
  source: 'manual' | 'onboarding';
  created_at: string;
}

/** タイヤ・ブレーキの点検・交換。Ledra から来た記録（source = 'ledra'）は編集できない */
export interface WearCheckRow {
  id: string;
  vehicle_id: string;
  kind: WearKind;
  performed_on: IsoDate;
  odo_km: number | null;
  replaced: boolean;
  /** Postgres の numeric は文字列で届く */
  remaining_mm: string | number | null;
  note: string | null;
  source: 'manual' | 'ledra';
  shop_name: string | null;
  created_at: string;
}

export type WearKind = 'tire' | 'brake';

export interface LedraLinkRow {
  id: string;
  status: 'active' | 'revoked_by_user' | 'revoked_by_provider';
  consent: { shop_name?: string | null } & Record<string, unknown>;
  consented_at: string;
  last_synced_at: string | null;
  revoked_at: string | null;
}

export interface NotificationLogRow {
  id: string;
  title: string;
  body: string;
  sent_at: string;
}

export interface VehicleBundle {
  vehicle: VehicleRow;
  oilChanges: OilChangeRow[];
  expenses: ExpenseRow[];
  wearChecks: WearCheckRow[];
  readings: OdometerReadingRow[];
  points: OdometerPointRow[];
  meterReplacements: MeterReplacementRow[];
  deadlines: DeadlineRow[];
  ledraLink: LedraLinkRow | null;
  notifications: NotificationLogRow[];
  state: VehicleState;
  today: IsoDate;
}

/** 車両のメーターの単位。DB の距離は km なので、画面の入力・表示だけこの単位にする */
export function vehicleUnit(v: Pick<VehicleRow, 'distance_unit'>): DistanceUnit {
  return v.distance_unit === 'mile' ? 'mile' : 'km';
}

export function todayJst(): IsoDate {
  return toJstDate(new Date());
}

export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export function useVehicles() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    // 利用者ごとに分け、ログインし直したときに前のアカウントのデータを使わない
    queryKey: ['vehicles', userId],
    enabled: !!userId,
    // 手放したクルマ（乗り換え・廃車）と、複数台プランの解約で休止中のクルマは、記録を残したままアプリには出さない
    queryFn: async () =>
      unwrap(await supabase.from('vehicles').select('*').eq('status', 'active').is('plan_suspended_at', null).order('created_at')) as VehicleRow[],
  });
}

const SELECTED_VEHICLE_KEY = 'ijilog.selectedVehicleId';

function useSelectedVehicleId() {
  return useQuery({
    queryKey: ['selectedVehicleId'],
    staleTime: Infinity,
    queryFn: async () => (await AsyncStorage.getItem(SELECTED_VEHICLE_KEY).catch(() => null)) ?? null,
  });
}

/** 表示する車両を切り替える。端末に覚えておき、次に開いたときも同じ車両を出す */
export async function selectVehicle(qc: QueryClient, vehicleId: string) {
  qc.setQueryData(['selectedVehicleId'], vehicleId);
  await AsyncStorage.setItem(SELECTED_VEHICLE_KEY, vehicleId).catch(() => {});
}

/**
 * いま表示している1台。選んだ車両が見つからなければ（削除した・別のアカウントで選んだ）最初に登録した1台を使う。
 * data は読み込み中が undefined、車両が1台もなければ null
 */
export function useVehicle() {
  const vehicles = useVehicles();
  const selected = useSelectedVehicleId();
  const list = vehicles.data;
  const data = list ? (list.find((v) => v.id === selected.data) ?? list[0] ?? null) : undefined;
  return {
    data,
    isPending: vehicles.isPending || selected.isPending,
    isError: vehicles.isError,
    refetch: vehicles.refetch,
  };
}

export type Plan = 'free' | 'plus';

/** DB の plan_status() の結果 */
export interface PlanStatus {
  plan: Plan;
  /** そのプランで登録できる台数（DB の vehicle_limit と同じ） */
  vehicleLimit: number;
  /** 表示している（手放しておらず休止もしていない）クルマの台数 */
  visibleCount: number;
  /** 解約後に上限を超えている。残すクルマを選ぶまで、ほかの画面に進めない */
  mustChooseVehicle: boolean;
  /** 休止中で、再契約だけで表示を戻せる台数 */
  suspendedRestorable: number;
  /** 休止から90日を過ぎ、表示を戻すのに事務手数料も要る台数 */
  suspendedNeedsFee: number;
  /** 事務手数料なしで戻せる期限がいちばん早いもの */
  restoreFreeUntil: string | null;
  hasUnusedRestoreFee: boolean;
  /** 運営が手で付けた複数台プラン（ストアの購入ではない） */
  manualPlus: boolean;
  subscription: { platform: 'ios' | 'android'; entitledUntil: string | null; autoRenew: boolean | null; active: boolean } | null;
}

/** プランと、休止中のクルマの状態 */
export function usePlan() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['plan', userId],
    enabled: !!userId,
    queryFn: async () => unwrap(await supabase.rpc('plan_status')) as PlanStatus,
  });
}

/** 解約後に残すクルマを1台選ぶ。ほかのクルマは休止になる */
export async function keepVehicle(vehicleId: string) {
  unwrap(await supabase.rpc('keep_vehicle', { p_vehicle_id: vehicleId }));
}

/** 再契約・事務手数料の支払いのあとに、休止中のクルマの表示を戻す。戻した台数を返す */
export async function restoreSuspendedVehicles(): Promise<number> {
  return unwrap(await supabase.rpc('restore_suspended_vehicles')) as number;
}

export function useVehicleBundle() {
  const vehicle = useVehicle();
  const vehicleId = vehicle.data?.id;
  const v = vehicle.data;
  const bundle = useQuery({
    queryKey: ['bundle', v?.user_id, vehicleId],
    enabled: !!vehicleId,
    queryFn: async (): Promise<VehicleBundle> => {
      if (!v) throw new Error('vehicle_not_loaded');
      const [oil, expenses, wear, readings, points, meters, deadlines, links, logs] = await Promise.all([
        supabase.from('oil_changes').select('*').eq('vehicle_id', v.id).order('performed_on', { ascending: false }),
        supabase.from('expenses').select('*').eq('vehicle_id', v.id).order('spent_on', { ascending: false }),
        supabase.from('wear_checks').select('*').eq('vehicle_id', v.id).order('performed_on', { ascending: false }),
        supabase.from('odometer_readings').select('*').eq('vehicle_id', v.id).order('read_on', { ascending: false }),
        supabase.from('odometer_points').select('vehicle_id, date, odo_km, source').eq('vehicle_id', v.id),
        supabase.from('meter_replacements').select('*').eq('vehicle_id', v.id).order('replaced_on'),
        supabase.from('deadlines').select('*').eq('vehicle_id', v.id).eq('status', 'active'),
        supabase.from('ledra_links').select('*').eq('vehicle_id', v.id).order('created_at', { ascending: false }).limit(1),
        supabase.from('notification_log').select('id, title, body, sent_at').eq('vehicle_id', v.id).order('sent_at', { ascending: false }).limit(20),
      ]);
      const today = todayJst();
      const rows = {
        oilChanges: unwrap(oil) as OilChangeRow[],
        points: unwrap(points) as OdometerPointRow[],
        meterReplacements: unwrap(meters) as MeterReplacementRow[],
        deadlines: unwrap(deadlines) as DeadlineRow[],
      };
      const linkRows = unwrap(links) as LedraLinkRow[];
      return {
        vehicle: v,
        ...rows,
        expenses: unwrap(expenses) as ExpenseRow[],
        wearChecks: unwrap(wear) as WearCheckRow[],
        readings: unwrap(readings) as OdometerReadingRow[],
        ledraLink: linkRows[0] ?? null,
        notifications: unwrap(logs) as NotificationLogRow[],
        state: buildVehicleState(toVehicleData(v, rows), today),
        today,
      };
    },
  });
  return { vehicle, bundle };
}

export function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

// ---------------------------------------------------------------------------
// 書き込み
// ---------------------------------------------------------------------------

export interface OnboardingInput {
  name: string;
  distanceUnit: DistanceUnit;
  plateNumber: string | null;
  odoKm: number;
  annualKmEstimate: number;
  shakenDueOn: IsoDate | null;
  insuranceDueOn: IsoDate | null;
  oilIntervalKm: number;
  oilIntervalMonths: number;
  filterIntervalKm: number;
  filterIntervalMonths: number;
}

export async function createVehicle(input: OnboardingInput) {
  const vehicle = unwrap(
    await supabase
      .from('vehicles')
      .insert({
        name: input.name,
        distance_unit: input.distanceUnit,
        plate_number: input.plateNumber,
        annual_km_estimate: input.annualKmEstimate,
        oil_interval_km: input.oilIntervalKm,
        oil_interval_months: input.oilIntervalMonths,
        filter_interval_km: input.filterIntervalKm,
        filter_interval_months: input.filterIntervalMonths,
      })
      .select('id')
      .single(),
  ) as { id: string };
  unwrap(
    await supabase
      .from('odometer_readings')
      .insert({ vehicle_id: vehicle.id, read_on: todayJst(), odo_km: input.odoKm, source: 'onboarding' }),
  );
  if (input.shakenDueOn) await registerDeadline(vehicle.id, 'shaken', input.shakenDueOn);
  if (input.insuranceDueOn) await registerDeadline(vehicle.id, 'insurance', input.insuranceDueOn);
  return vehicle;
}

export type ReleaseReason = 'transferred' | 'scrapped';

/**
 * クルマを手放す（乗り換え・廃車）。アプリからは見えなくなるが、記録は消さずに残す。
 * 整備工場との連携の解除と、廃車のときの Ledra への通知はサーバー（vehicle-release）が行う
 */
export async function releaseVehicle(input: { vehicleId: string; reason: ReleaseReason; releasedOn: IsoDate; shareHistory: boolean }) {
  return invokeFunction<{ ok: true; ledraLinked: boolean }>('vehicle-release', { ...input });
}

// ---------------------------------------------------------------------------
// 愛車の写真
// ---------------------------------------------------------------------------

const PHOTO_BUCKET = 'vehicle-photos';
/** 表示用の期限付き URL の有効期間。期限より少し早めに取り直す */
const PHOTO_URL_TTL_SECONDS = 60 * 60;

/** 写真の表示用 URL。差し替えるとパスが変わるので、パスごとに覚えておく */
export function useVehiclePhotoUrl(path: string | null) {
  return useQuery({
    queryKey: ['vehiclePhoto', path],
    enabled: !!path,
    staleTime: (PHOTO_URL_TTL_SECONDS - 10 * 60) * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path!, PHOTO_URL_TTL_SECONDS);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function removePhotoFile(path: string) {
  // 消せなくても利用者の操作は止めない（他人からは読めないフォルダに残るだけ）
  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([path]);
  if (error) console.warn('写真の削除に失敗しました', error.message);
}

/**
 * 写真を差し替える。毎回新しいファイル名で置き、車両の行を書き換えてから古い写真を消す
 * （同じ名前で上書きすると、配信のキャッシュで古い写真が出ることがあるため）
 */
export async function saveVehiclePhoto(vehicle: Pick<VehicleRow, 'id' | 'user_id' | 'photo_path'>, jpegBase64: string) {
  const path = `${vehicle.user_id}/${vehicle.id}-${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, base64ToBytes(jpegBase64), { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  try {
    await updateVehicle(vehicle.id, { photo_path: path, photo_updated_at: new Date().toISOString() });
  } catch (e) {
    await removePhotoFile(path);
    throw e;
  }
  if (vehicle.photo_path) await removePhotoFile(vehicle.photo_path);
}

export async function removeVehiclePhoto(vehicle: Pick<VehicleRow, 'id' | 'photo_path'>) {
  await updateVehicle(vehicle.id, { photo_path: null, photo_updated_at: null });
  if (vehicle.photo_path) await removePhotoFile(vehicle.photo_path);
}

export async function updateVehicle(id: string, patch: Partial<Omit<VehicleRow, 'id' | 'user_id'>>) {
  unwrap(await supabase.from('vehicles').update(patch).eq('id', id));
}

export async function registerDeadline(vehicleId: string, kind: DeadlineKind, dueOn: IsoDate) {
  unwrap(await supabase.rpc('register_deadline', { p_vehicle_id: vehicleId, p_kind: kind, p_due_on: dueOn }));
}

export async function removeDeadline(id: string) {
  unwrap(await supabase.from('deadlines').delete().eq('id', id));
}

export interface OilChangeInput {
  id?: string;
  vehicleId: string;
  date: IsoDate;
  odoKm: number;
  oilChanged: boolean;
  filterChanged: boolean;
  amountYen: number | null;
  payment?: PaymentDetails;
}

/** 自分で入力したオイル交換を保存する。金額はその記録に紐づく支出1件として持つ（二重計上しない） */
export async function saveOilChange(input: OilChangeInput) {
  const row = {
    vehicle_id: input.vehicleId,
    performed_on: input.date,
    odo_km: input.odoKm,
    oil_changed: input.oilChanged,
    filter_changed: input.filterChanged,
  };
  const saved = unwrap(
    input.id
      ? await supabase.from('oil_changes').update(row).eq('id', input.id).select('id').single()
      : await supabase.from('oil_changes').insert(row).select('id').single(),
  ) as { id: string };
  await saveOilChangeAmount(input.vehicleId, saved.id, input.date, input.amountYen, input.payment);
  return saved;
}

/** Ledra から来た記録にも、金額だけは後から追記できる */
export async function saveOilChangeAmount(
  vehicleId: string,
  oilChangeId: string,
  date: IsoDate,
  amountYen: number | null,
  payment: PaymentDetails = PAID_NOW,
) {
  if (amountYen == null || amountYen <= 0) {
    unwrap(await supabase.from('expenses').delete().eq('oil_change_id', oilChangeId));
    return;
  }
  unwrap(
    await supabase.from('expenses').upsert(
      {
        vehicle_id: vehicleId,
        oil_change_id: oilChangeId,
        category: 'oil_change',
        spent_on: date,
        amount_yen: amountYen,
        on_account: payment.onAccount,
        entered_amount_yen: payment.onAccount ? payment.enteredAmountYen : null,
        exempt_yen: payment.exemptYen,
      },
      { onConflict: 'oil_change_id' },
    ),
  );
}

export async function deleteOilChange(id: string) {
  // 紐づく支出は外部キーの連鎖で消える
  unwrap(await supabase.from('oil_changes').delete().eq('id', id));
}

export interface ExpenseInput {
  id?: string;
  vehicleId: string;
  category: Exclude<ExpenseCategory, 'oil_change'>;
  date: IsoDate;
  amountYen: number;
  odoKm: number | null;
  note: string | null;
  /** 給油のときだけ。給油以外は null を入れる */
  fuel: FuelDetails | null;
  payment: PaymentDetails;
}

/** 支払い方法と税の区分（確定申告のまとめに使う） */
export interface PaymentDetails {
  onAccount: boolean;
  /** かけのとき入れた税抜の金額（給油以外） */
  enteredAmountYen: number | null;
  /** 消費税のかからない分（車検の法定費用など） */
  exemptYen: number | null;
}

export const PAID_NOW: PaymentDetails = { onAccount: false, enteredAmountYen: null, exemptYen: null };

export interface FuelDetails {
  liters: number | null;
  unitPrice: number | null;
  /** 単価を入れたときだけ（DB の check で単価と組にしている） */
  priceBasis: FuelPriceBasis | null;
  fuelType: FuelType | null;
  fullTank: boolean;
}

/** 給油の記録を燃費の計算の形にする（日付の古い順。同じ日は記録した順） */
export function fuelFills(expenses: ExpenseRow[]): FuelFill[] {
  return expenses
    .filter((e) => e.category === 'fuel')
    .sort((a, b) => (a.spent_on === b.spent_on ? a.created_at.localeCompare(b.created_at) : a.spent_on < b.spent_on ? -1 : 1))
    .map((e) => ({
      id: e.id,
      date: e.spent_on,
      odoKm: e.odo_km,
      liters: e.fuel_liters != null ? Number(e.fuel_liters) : null,
      fullTank: e.fuel_full_tank === true,
      amountYen: e.amount_yen,
    }));
}

/** 支出の行を確定申告のまとめの形にする */
export function bookkeepingExpenses(expenses: ExpenseRow[]): BookkeepingExpense[] {
  return expenses.map((e) => ({
    date: e.spent_on,
    category: e.category,
    amountYen: e.amount_yen,
    onAccount: e.on_account === true,
    enteredAmountYen: e.entered_amount_yen,
    exemptYen: e.exempt_yen,
    fuel:
      e.category === 'fuel'
        ? {
            fuelType: e.fuel_type,
            liters: e.fuel_liters != null ? Number(e.fuel_liters) : null,
            unitPrice: e.fuel_unit_price != null ? Number(e.fuel_unit_price) : null,
            basis: e.fuel_price_basis,
          }
        : null,
    note: e.note,
  }));
}

/** 保存した記録の ID を返す（保存直後に「内容を直す」から編集画面を開くため） */
export async function saveExpense(input: ExpenseInput): Promise<{ id: string }> {
  const row = {
    vehicle_id: input.vehicleId,
    category: input.category,
    spent_on: input.date,
    amount_yen: input.amountYen,
    odo_km: input.odoKm,
    note: input.note,
    fuel_liters: input.fuel?.liters ?? null,
    fuel_unit_price: input.fuel?.unitPrice ?? null,
    fuel_price_basis: input.fuel?.unitPrice != null ? input.fuel.priceBasis : null,
    fuel_type: input.fuel?.fuelType ?? null,
    fuel_full_tank: input.fuel ? input.fuel.fullTank : null,
    on_account: input.payment.onAccount,
    entered_amount_yen: input.payment.onAccount && input.category !== 'fuel' ? input.payment.enteredAmountYen : null,
    exempt_yen: input.payment.exemptYen,
  };
  return unwrap(
    input.id
      ? await supabase.from('expenses').update(row).eq('id', input.id).select('id').single()
      : await supabase.from('expenses').insert(row).select('id').single(),
  ) as { id: string };
}

export async function deleteExpense(id: string) {
  unwrap(await supabase.from('expenses').delete().eq('id', id));
}

export interface WearCheckInput {
  id?: string;
  vehicleId: string;
  kind: WearKind;
  date: IsoDate;
  odoKm: number | null;
  replaced: boolean;
  remainingMm: number | null;
  note: string | null;
}

export async function saveWearCheck(input: WearCheckInput): Promise<{ id: string }> {
  const row = {
    vehicle_id: input.vehicleId,
    kind: input.kind,
    performed_on: input.date,
    odo_km: input.odoKm,
    replaced: input.replaced,
    remaining_mm: input.remainingMm,
    note: input.note,
  };
  return unwrap(
    input.id
      ? await supabase.from('wear_checks').update(row).eq('id', input.id).select('id').single()
      : await supabase.from('wear_checks').insert(row).select('id').single(),
  ) as { id: string };
}

export async function deleteWearCheck(id: string) {
  unwrap(await supabase.from('wear_checks').delete().eq('id', id));
}

export async function saveOdoReading(input: { id?: string; vehicleId: string; date: IsoDate; odoKm: number }): Promise<{ id: string }> {
  const row = { vehicle_id: input.vehicleId, read_on: input.date, odo_km: input.odoKm };
  return unwrap(
    input.id
      ? await supabase.from('odometer_readings').update(row).eq('id', input.id).select('id').single()
      : await supabase.from('odometer_readings').insert({ ...row, source: 'manual' }).select('id').single(),
  ) as { id: string };
}

export async function deleteOdoReading(id: string) {
  unwrap(await supabase.from('odometer_readings').delete().eq('id', id));
}

export async function addMeterReplacement(input: {
  vehicleId: string;
  date: IsoDate;
  odoBeforeKm: number;
  odoAfterKm: number;
}) {
  unwrap(
    await supabase.from('meter_replacements').insert({
      vehicle_id: input.vehicleId,
      replaced_on: input.date,
      odo_before_km: input.odoBeforeKm,
      odo_after_km: input.odoAfterKm,
    }),
  );
}

export async function deleteMeterReplacement(id: string) {
  unwrap(await supabase.from('meter_replacements').delete().eq('id', id));
}

// ---------------------------------------------------------------------------
// 整備工場（掲載店）
// ---------------------------------------------------------------------------

export interface ShopRow {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  latitude: number;
  longitude: number;
  business_hours: string | null;
  description: string | null;
  website_url: string | null;
  services: string[];
  display_priority: number;
}

/** 掲載中の整備工場（掲載期間外・非公開の店舗は RLS で返らない） */
export function useShops() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['shops', userId],
    enabled: !!userId,
    staleTime: 10 * 60_000,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('shops')
          .select('id, name, address, phone, latitude, longitude, business_hours, description, website_url, services, display_priority')
          .order('name'),
      ) as ShopRow[],
  });
}

export type ShopAction = 'view' | 'route' | 'call' | 'website';

/** 送客の記録（掲載店への報告に使う）。記録できなくても利用者の操作は止めない */
export function logShopAction(shopId: string, action: ShopAction) {
  supabase
    .from('shop_referrals')
    .insert({ shop_id: shopId, action })
    .then(({ error }) => {
      if (error) console.warn('送客の記録に失敗しました', error.message);
    });
}

// ---------------------------------------------------------------------------
// 入力の計測（実証実験の KPI 用。docs/open-questions.md 50）
// ---------------------------------------------------------------------------

export interface InputSession {
  vehicleId: string;
  kind: string;
  mode: 'new' | 'edit';
  method: 'manual' | 'photo' | 'voice';
  outcome: 'saved' | 'abandoned';
  openedAt: Date;
  finishedAt: Date;
  draftFields: number;
  draftFieldsChanged: number;
  warningsShown: number;
  recordRef: string | null;
}

/** 記録画面1回分の計測を送る。送れなくても利用者の操作は止めない */
export function logInputSession(s: InputSession) {
  supabase
    .from('input_sessions')
    .insert({
      vehicle_id: s.vehicleId,
      kind: s.kind,
      mode: s.mode,
      method: s.method,
      outcome: s.outcome,
      opened_at: s.openedAt.toISOString(),
      finished_at: s.finishedAt.toISOString(),
      draft_fields: Math.min(s.draftFields, 20),
      draft_fields_changed: Math.min(s.draftFieldsChanged, s.draftFields, 20),
      warnings_shown: Math.min(s.warningsShown, 20),
      record_ref: s.recordRef,
      app_version: Constants.expoConfig?.version ?? null,
    })
    .then(({ error }) => {
      if (error) console.warn('入力の計測を送れませんでした', error.message);
    });
}

// ---------------------------------------------------------------------------
// 車検証
// ---------------------------------------------------------------------------

/** 車検証の項目のうち vehicles に持つもの（税の計算に使う）。それ以外は vehicle_certificates */
const CERTIFICATE_VEHICLE_FIELDS = [
  'firstRegisteredOn',
  'vehicleClass',
  'usage',
  'businessClass',
  'displacementCc',
  'powertrain',
  'seatingCapacity',
  'maxLoadKg',
  'vehicleWeightKg',
  'grossWeightKg',
] as const satisfies readonly (keyof VehicleCertificate)[];

const CERTIFICATE_TABLE_FIELDS = (Object.keys(EMPTY_CERTIFICATE) as (keyof VehicleCertificate)[]).filter(
  (k) => !(CERTIFICATE_VEHICLE_FIELDS as readonly string[]).includes(k),
);

/** registeredOn → registered_on、axleFfKg → axle_ff_kg */
function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function useVehicleCertificate(vehicle: VehicleRow | undefined) {
  return useQuery({
    queryKey: ['vehicle-certificate', vehicle?.user_id, vehicle?.id],
    enabled: !!vehicle,
    queryFn: async (): Promise<VehicleCertificate> => {
      const rows = unwrap(await supabase.from('vehicle_certificates').select('*').eq('vehicle_id', vehicle!.id)) as Record<string, unknown>[];
      const row = rows[0] ?? {};
      const v = vehicle as unknown as Record<string, unknown>;
      const cert = { ...EMPTY_CERTIFICATE } as Record<string, unknown>;
      for (const k of CERTIFICATE_TABLE_FIELDS) cert[k] = row[snake(k)] ?? null;
      for (const k of CERTIFICATE_VEHICLE_FIELDS) cert[k] = v[snake(k)] ?? null;
      return cert as unknown as VehicleCertificate;
    },
  });
}

/**
 * 車検証を保存する。税の計算に使う項目は vehicles に、それ以外は vehicle_certificates に入れる。
 * ナンバーが未登録なら車検証のナンバーを入れ、満了日が今の車検の期限と違えば期限も更新する
 */
export async function saveVehicleCertificate(vehicle: VehicleRow, cert: VehicleCertificate, currentShakenDueOn: IsoDate | null) {
  const certRow: Record<string, unknown> = { vehicle_id: vehicle.id };
  for (const k of CERTIFICATE_TABLE_FIELDS) certRow[snake(k)] = cert[k];
  unwrap(await supabase.from('vehicle_certificates').upsert(certRow, { onConflict: 'vehicle_id' }));
  const patch: Record<string, unknown> = {};
  for (const k of CERTIFICATE_VEHICLE_FIELDS) patch[snake(k)] = cert[k];
  if (!vehicle.plate_number && cert.registrationNumber) patch.plate_number = cert.registrationNumber.slice(0, 30);
  await updateVehicle(vehicle.id, patch as Partial<Omit<VehicleRow, 'id' | 'user_id'>>);
  if (cert.expiresOn && cert.expiresOn !== currentShakenDueOn) await registerDeadline(vehicle.id, 'shaken', cert.expiresOn);
}
