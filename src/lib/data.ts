/**
 * 画面から使うデータの読み書き。読み取りは react-query でまとめ、書き込み後に再取得する。
 * RLS により、ここで読めるのは本人のデータだけ。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toJstDate, type IsoDate } from '@domain/dates.ts';
import type { ExpenseCategory } from '@domain/costs.ts';
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
import { supabase } from './supabase';

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
  readings: OdometerReadingRow[];
  points: OdometerPointRow[];
  meterReplacements: MeterReplacementRow[];
  deadlines: DeadlineRow[];
  ledraLink: LedraLinkRow | null;
  notifications: NotificationLogRow[];
  state: VehicleState;
  today: IsoDate;
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
    queryFn: async () => unwrap(await supabase.from('vehicles').select('*').order('created_at')) as VehicleRow[],
  });
}

const SELECTED_VEHICLE_KEY = 'carkeibo.selectedVehicleId';

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

/** プランと、そのプランで登録できる台数（上限は DB の vehicle_limit と同じものを使う） */
export function usePlan() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['plan', userId],
    enabled: !!userId,
    queryFn: async () => {
      const profile = unwrap(await supabase.from('profiles').select('plan').eq('id', userId!).maybeSingle()) as { plan: Plan } | null;
      const plan = profile?.plan ?? 'free';
      const limit = unwrap(await supabase.rpc('vehicle_limit', { p_plan: plan })) as number;
      return { plan, vehicleLimit: limit };
    },
  });
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
      const [oil, expenses, readings, points, meters, deadlines, links, logs] = await Promise.all([
        supabase.from('oil_changes').select('*').eq('vehicle_id', v.id).order('performed_on', { ascending: false }),
        supabase.from('expenses').select('*').eq('vehicle_id', v.id).order('spent_on', { ascending: false }),
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

/** 車両と、その車両の記録・期限・連携をすべて削除する（子テーブルは外部キーの連鎖で消える。写真は別に消す） */
export async function deleteVehicle(vehicle: Pick<VehicleRow, 'id' | 'photo_path'>) {
  unwrap(await supabase.from('vehicles').delete().eq('id', vehicle.id));
  if (vehicle.photo_path) await removePhotoFile(vehicle.photo_path);
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
  await saveOilChangeAmount(input.vehicleId, saved.id, input.date, input.amountYen);
  return saved;
}

/** Ledra から来た記録にも、金額だけは後から追記できる */
export async function saveOilChangeAmount(vehicleId: string, oilChangeId: string, date: IsoDate, amountYen: number | null) {
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
