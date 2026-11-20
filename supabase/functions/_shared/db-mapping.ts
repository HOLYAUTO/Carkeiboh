/**
 * DB の行（snake_case）を domain の VehicleData に詰め替える。アプリとサーバーで共有する。
 */
import type { MeterReplacement } from './domain/odo.ts';
import type { VehicleData } from './domain/vehicle.ts';
import type { DeadlineKind, ReminderKind } from './domain/reminders.ts';
import { isDistanceUnit, type DistanceUnit } from './domain/units.ts';
import type { Powertrain, VehicleClass, VehicleTaxSpec } from './domain/vehicle-tax.ts';
import type { BusinessClass, VehicleUsage } from './domain/vehicle-certificate.ts';

export interface VehicleRow {
  id: string;
  user_id: string;
  name: string;
  plate_number: string | null;
  annual_km_estimate: number;
  oil_interval_km: number | null;
  oil_interval_months: number | null;
  filter_interval_km: number | null;
  filter_interval_months: number | null;
  notify_oil: boolean;
  notify_filter: boolean;
  notify_shaken: boolean;
  notify_inspection: boolean;
  notify_insurance: boolean;
  notify_car_tax: boolean;
  /** 愛車の写真（Storage の vehicle-photos の中のパス）。未設定は null */
  photo_path: string | null;
  photo_updated_at: string | null;
  /** メーターの単位。DB の距離はすべて km で持ち、画面と通知の文だけこの単位にする */
  distance_unit: DistanceUnit;
  /** 仕事で使う割合（%、確定申告のまとめに使う）。未設定は null */
  business_use_percent?: number | null;
  /** 自動車税・重量税の計算に使う車検証の項目（任意） */
  vehicle_class?: VehicleClass | null;
  displacement_cc?: number | null;
  first_registered_on?: string | null;
  powertrain?: Powertrain | null;
  vehicle_weight_kg?: number | null;
  /** 車検証の用途・自家用/事業用・乗車定員・最大積載量・車両総重量（任意） */
  usage?: VehicleUsage | null;
  business_class?: BusinessClass | null;
  seating_capacity?: number | null;
  max_load_kg?: number | null;
  gross_weight_kg?: number | null;
}

/** 車両の行を、自動車税・重量税の計算の形にする */
export function vehicleTaxSpec(v: VehicleRow): VehicleTaxSpec {
  return {
    vehicleClass: v.vehicle_class ?? null,
    displacementCc: v.displacement_cc ?? null,
    firstRegisteredOn: v.first_registered_on ?? null,
    powertrain: v.powertrain ?? null,
    vehicleWeightKg: v.vehicle_weight_kg ?? null,
    usage: v.usage ?? null,
    businessClass: v.business_class ?? null,
    seatingCapacity: v.seating_capacity ?? null,
    maxLoadKg: v.max_load_kg ?? null,
    grossWeightKg: v.gross_weight_kg ?? null,
  };
}

export interface OilChangeRow {
  id: string;
  vehicle_id: string;
  performed_on: string;
  odo_km: number;
  oil_changed: boolean;
  filter_changed: boolean;
  source: 'manual' | 'ledra';
  shop_name: string | null;
  ledra_record_id: string | null;
  created_at: string;
}

export interface OdometerPointRow {
  vehicle_id: string;
  date: string;
  odo_km: number;
  source: 'reading' | 'oil_change' | 'expense' | 'wear_check';
}

export interface MeterReplacementRow {
  id: string;
  vehicle_id: string;
  replaced_on: string;
  odo_before_km: number;
  odo_after_km: number;
}

export interface DeadlineRow {
  id: string;
  vehicle_id: string;
  kind: DeadlineKind;
  due_on: string;
  status: 'active' | 'superseded';
}

export function reminderSettings(v: VehicleRow): Record<ReminderKind, boolean> {
  return {
    oil: v.notify_oil,
    filter: v.notify_filter,
    shaken: v.notify_shaken,
    inspection: v.notify_inspection,
    insurance: v.notify_insurance,
    car_tax: v.notify_car_tax,
  };
}

/** メーター交換の行を、走行距離の計算（@domain/odo）の形にする */
export function toMeterReplacements(rows: MeterReplacementRow[]): MeterReplacement[] {
  return rows.map((m) => ({ replacedOn: m.replaced_on, odoBeforeKm: m.odo_before_km, odoAfterKm: m.odo_after_km }));
}

export function toVehicleData(
  v: VehicleRow,
  rows: {
    oilChanges: OilChangeRow[];
    points: OdometerPointRow[];
    meterReplacements: MeterReplacementRow[];
    deadlines: DeadlineRow[];
  },
): VehicleData {
  return {
    name: v.name,
    annualKmEstimate: v.annual_km_estimate,
    oilInterval: { km: v.oil_interval_km, months: v.oil_interval_months },
    filterInterval: { km: v.filter_interval_km, months: v.filter_interval_months },
    settings: reminderSettings(v),
    oilChanges: rows.oilChanges.map((o) => ({
      id: o.id,
      date: o.performed_on,
      odoKm: o.odo_km,
      oilChanged: o.oil_changed,
      filterChanged: o.filter_changed,
    })),
    otherReadings: rows.points
      .filter((p) => p.source !== 'oil_change')
      .map((p) => ({ date: p.date, odoKm: p.odo_km })),
    meterReplacements: toMeterReplacements(rows.meterReplacements),
    deadlines: rows.deadlines
      .filter((d) => d.status === 'active')
      .map((d) => ({ id: d.id, kind: d.kind, dueOn: d.due_on })),
    distanceUnit: isDistanceUnit(v.distance_unit) ? v.distance_unit : 'km',
  };
}
