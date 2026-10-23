/**
 * 画面から使うデータの読み書き。読み取りは react-query でまとめ、書き込み後に再取得する。
 * RLS により、ここで読めるのは本人のデータだけ。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** 初期版は1アカウント1台。データ構造は複数台を持てるので、先頭の1台を使う */
export function useVehicle() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    // 利用者ごとに分け、ログインし直したときに前のアカウントのデータを使わない
    queryKey: ['vehicle', userId],
    enabled: !!userId,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('vehicles').select('*').order('created_at').limit(1));
      return (rows as VehicleRow[])[0] ?? null;
    },
  });
}

export function useVehicleBundle() {
  const vehicle = useVehicle();
  const vehicleId = vehicle.data?.id;
  const bundle = useQuery({
    queryKey: ['bundle', vehicle.data?.user_id, vehicleId],
    enabled: !!vehicleId,
    queryFn: async (): Promise<VehicleBundle> => {
      const v = vehicle.data!;
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

export async function saveExpense(input: ExpenseInput) {
  const row = {
    vehicle_id: input.vehicleId,
    category: input.category,
    spent_on: input.date,
    amount_yen: input.amountYen,
    odo_km: input.odoKm,
    note: input.note,
  };
  unwrap(
    input.id
      ? await supabase.from('expenses').update(row).eq('id', input.id)
      : await supabase.from('expenses').insert(row),
  );
}

export async function deleteExpense(id: string) {
  unwrap(await supabase.from('expenses').delete().eq('id', id));
}

export async function saveOdoReading(input: { id?: string; vehicleId: string; date: IsoDate; odoKm: number }) {
  const row = { vehicle_id: input.vehicleId, read_on: input.date, odo_km: input.odoKm };
  unwrap(
    input.id
      ? await supabase.from('odometer_readings').update(row).eq('id', input.id)
      : await supabase.from('odometer_readings').insert({ ...row, source: 'manual' }),
  );
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
