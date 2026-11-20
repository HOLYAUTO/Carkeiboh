/** 記録（オイル交換・支出・タイヤ／ブレーキ・走行距離・メーター交換）の書き込み */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExpenseCategory } from '@domain/costs.ts';
import type { IsoDate } from '@domain/dates.ts';
import type { FuelPriceBasis, FuelType } from '@domain/fuel.ts';
import { deleteRow, saveRow, unwrap } from '../db';
import { STORAGE_KEYS } from '../storage-keys';
import { supabase } from '../supabase';
import type { WearKind } from './rows';

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
  const saved = await saveRow(
    'oil_changes',
    {
      vehicle_id: input.vehicleId,
      performed_on: input.date,
      odo_km: input.odoKm,
      oil_changed: input.oilChanged,
      filter_changed: input.filterChanged,
    },
    input.id,
  );
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

/** 紐づく支出は外部キーの連鎖で消える */
export const deleteOilChange = (id: string) => deleteRow('oil_changes', id);

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

/** 保存した記録の ID を返す（保存直後に「内容を直す」から編集画面を開くため） */
export async function saveExpense(input: ExpenseInput): Promise<{ id: string }> {
  // スタンドに立ち寄っているあいだに給油を記録したら、出たときの「給油しましたか？」を出さない（src/lib/fuel-geofence.ts）
  if (input.category === 'fuel' && !input.id) await AsyncStorage.setItem(STORAGE_KEYS.lastFuelSavedAt, String(Date.now())).catch(() => {});
  return saveRow(
    'expenses',
    {
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
    },
    input.id,
  );
}

export const deleteExpense = (id: string) => deleteRow('expenses', id);

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
  return saveRow(
    'wear_checks',
    {
      vehicle_id: input.vehicleId,
      kind: input.kind,
      performed_on: input.date,
      odo_km: input.odoKm,
      replaced: input.replaced,
      remaining_mm: input.remainingMm,
      note: input.note,
    },
    input.id,
  );
}

export const deleteWearCheck = (id: string) => deleteRow('wear_checks', id);

export async function saveOdoReading(input: { id?: string; vehicleId: string; date: IsoDate; odoKm: number }): Promise<{ id: string }> {
  const row = { vehicle_id: input.vehicleId, read_on: input.date, odo_km: input.odoKm };
  // 追加のときだけ「手で入れた」を付ける（初回登録で入れた値は source が onboarding のまま）
  return saveRow('odometer_readings', input.id ? row : { ...row, source: 'manual' }, input.id);
}

export const deleteOdoReading = (id: string) => deleteRow('odometer_readings', id);

export async function addMeterReplacement(input: { vehicleId: string; date: IsoDate; odoBeforeKm: number; odoAfterKm: number }) {
  unwrap(
    await supabase.from('meter_replacements').insert({
      vehicle_id: input.vehicleId,
      replaced_on: input.date,
      odo_before_km: input.odoBeforeKm,
      odo_after_km: input.odoAfterKm,
    }),
  );
}

export const deleteMeterReplacement = (id: string) => deleteRow('meter_replacements', id);
