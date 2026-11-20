/** DB の行の形と、行を計算（@domain）の形に詰め替える関数 */
import type { BookkeepingExpense } from '@domain/bookkeeping.ts';
import type { ExpenseCategory } from '@domain/costs.ts';
import type { IsoDate } from '@domain/dates.ts';
import type { FuelFill, FuelPriceBasis, FuelType } from '@domain/fuel.ts';
import type { VehicleState } from '@domain/vehicle.ts';
import type { DeadlineRow, MeterReplacementRow, OdometerPointRow, OilChangeRow, VehicleRow } from '@shared/db-mapping.ts';

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
  /** ledra：整備工場（Ledra）から取り込んだ金額。利用者は変えられない */
  source?: 'manual' | 'ledra';
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

export type WearKind = 'tire' | 'brake';

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

/** 表示している1台と、その記録・計算済みの状態 */
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
