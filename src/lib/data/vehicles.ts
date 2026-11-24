/** 車両・プラン・期限と、表示している1台の記録の読み込み */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toJstDate, type IsoDate } from '@domain/dates.ts';
import type { DeadlineKind } from '@domain/reminders.ts';
import type { DistanceUnit } from '@domain/units.ts';
import { buildVehicleState } from '@domain/vehicle.ts';
import { toVehicleData } from '@shared/db-mapping.ts';
import { useAuth } from '../auth';
import { unwrap } from '../db';
import { STORAGE_KEYS } from '../storage-keys';
import { invokeFunction, supabase } from '../supabase';
import type {
  DeadlineRow,
  ExpenseRow,
  LedraLinkRow,
  MeterReplacementRow,
  NotificationLogRow,
  OdometerPointRow,
  OdometerReadingRow,
  OilChangeRow,
  VehicleBundle,
  VehicleRow,
  WearCheckRow,
} from './rows';

/** 車両のメーターの単位。DB の距離は km なので、画面の入力・表示だけこの単位にする */
export function vehicleUnit(v: Pick<VehicleRow, 'distance_unit'>): DistanceUnit {
  return v.distance_unit === 'mile' ? 'mile' : 'km';
}

export function todayJst(): IsoDate {
  return toJstDate(new Date());
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

function useSelectedVehicleId() {
  return useQuery({
    queryKey: ['selectedVehicleId'],
    staleTime: Infinity,
    queryFn: async () => (await AsyncStorage.getItem(STORAGE_KEYS.selectedVehicleId).catch(() => null)) ?? null,
  });
}

/** 表示する車両を切り替える。端末に覚えておき、次に開いたときも同じ車両を出す */
export async function selectVehicle(qc: QueryClient, vehicleId: string) {
  qc.setQueryData(['selectedVehicleId'], vehicleId);
  await AsyncStorage.setItem(STORAGE_KEYS.selectedVehicleId, vehicleId).catch(() => {});
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
    error: vehicles.error,
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

/** 車両ごとの記録。車両の行そのものは含めず、表示のたびに最新の車両と組み合わせる */
type VehicleRecords = Omit<VehicleBundle, 'vehicle' | 'state'>;

export function useVehicleBundle() {
  const vehicle = useVehicle();
  const v = vehicle.data;
  const vehicleId = v?.id;
  // 記録の取得と、最新の車両との組み合わせを分ける。取得の中で車両を使うと、
  // 車両と記録を同時に読み直したとき（写真の追加・車両の設定の保存のあと）に、
  // 読み直す前の古い車両が残り、写真や設定の変更が画面に出なくなるため
  const select = useCallback(
    (records: VehicleRecords): VehicleBundle => {
      // 記録は車両 ID ごとに覚えているので、ここに来るときは必ず同じ車両が読み込まれている
      const current = v!;
      return {
        ...records,
        vehicle: current,
        state: buildVehicleState(toVehicleData(current, records), records.today),
      };
    },
    [v],
  );
  const bundle = useQuery({
    queryKey: ['bundle', v?.user_id, vehicleId],
    enabled: !!vehicleId,
    select,
    queryFn: async (): Promise<VehicleRecords> => {
      if (!vehicleId) throw new Error('vehicle_not_loaded');
      const [oil, expenses, wear, readings, points, meters, deadlines, links, logs] = await Promise.all([
        supabase.from('oil_changes').select('*').eq('vehicle_id', vehicleId).order('performed_on', { ascending: false }),
        supabase.from('expenses').select('*').eq('vehicle_id', vehicleId).order('spent_on', { ascending: false }),
        supabase.from('wear_checks').select('*').eq('vehicle_id', vehicleId).order('performed_on', { ascending: false }),
        supabase.from('odometer_readings').select('*').eq('vehicle_id', vehicleId).order('read_on', { ascending: false }),
        supabase.from('odometer_points').select('vehicle_id, date, odo_km, source').eq('vehicle_id', vehicleId),
        supabase.from('meter_replacements').select('*').eq('vehicle_id', vehicleId).order('replaced_on'),
        supabase.from('deadlines').select('*').eq('vehicle_id', vehicleId).eq('status', 'active'),
        supabase.from('ledra_links').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }).limit(1),
        supabase.from('notification_log').select('id, title, body, sent_at').eq('vehicle_id', vehicleId).order('sent_at', { ascending: false }).limit(20),
      ]);
      const linkRows = unwrap(links) as LedraLinkRow[];
      return {
        oilChanges: unwrap(oil) as OilChangeRow[],
        points: unwrap(points) as OdometerPointRow[],
        meterReplacements: unwrap(meters) as MeterReplacementRow[],
        deadlines: unwrap(deadlines) as DeadlineRow[],
        expenses: unwrap(expenses) as ExpenseRow[],
        wearChecks: unwrap(wear) as WearCheckRow[],
        readings: unwrap(readings) as OdometerReadingRow[],
        ledraLink: linkRows[0] ?? null,
        notifications: unwrap(logs) as NotificationLogRow[],
        today: todayJst(),
      };
    },
  });
  return { vehicle, bundle };
}

/** 書き込みのあとに、読み込んだものをすべて読み直す */
export function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

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

export async function updateVehicle(id: string, patch: Partial<Omit<VehicleRow, 'id' | 'user_id'>>) {
  unwrap(await supabase.from('vehicles').update(patch).eq('id', id));
}

export type ReleaseReason = 'transferred' | 'scrapped';

/**
 * クルマを手放す（乗り換え・廃車）。アプリからは見えなくなるが、記録は消さずに残す。
 * 整備工場との連携の解除と、廃車のときの Ledra への通知はサーバー（vehicle-release）が行う
 */
export async function releaseVehicle(input: { vehicleId: string; reason: ReleaseReason; releasedOn: IsoDate; shareHistory: boolean }) {
  return invokeFunction<{ ok: true; ledraLinked: boolean }>('vehicle-release', { ...input });
}

export async function registerDeadline(vehicleId: string, kind: DeadlineKind, dueOn: IsoDate) {
  unwrap(await supabase.rpc('register_deadline', { p_vehicle_id: vehicleId, p_kind: kind, p_due_on: dueOn }));
}

export async function removeDeadline(id: string) {
  unwrap(await supabase.from('deadlines').delete().eq('id', id));
}
