/** 記録フォームの入力値と、その初期値・税額の計算 */
import { automobileTaxFor, fiscalYearOf, vehicleTaxSpecLabel, weightTaxFor } from '@domain/vehicle-tax.ts';
import { canBeOnAccount } from '@domain/bookkeeping.ts';
import { calculateFuelCost, type FuelType } from '@domain/fuel.ts';
import { dailyPace, estimatedMeterReading } from '@domain/pace.ts';
import { fromKm, type DistanceUnit } from '@domain/units.ts';
import { taxPrefecture, type VehicleCertificate } from '@domain/vehicle-certificate.ts';
import { toMeterReplacements, vehicleTaxSpec } from '@shared/db-mapping.ts';
import type { VehicleBundle, VehicleRow } from '../../lib/data';
import { parseDecimal } from '../../lib/format';
import { isWearKind, type EditTarget, type RecordKind } from '../../lib/record-kinds';

/** 入力欄の値（入力したままの文字）。最初の値と比べて、入力途中かを決める */
export interface FormValues {
  date: string;
  /** 走行距離。車両の単位（km / mile）で入れる */
  odoText: string;
  amount: string;
  liters: string;
  unitPrice: string;
  fuelType: FuelType;
  /** かけ（後払い）か */
  onAccount: boolean;
  /** 車検の「うち法定費用」 */
  exempt: string;
  fullTank: boolean;
  note: string;
  replaced: boolean;
  remaining: string;
  filterChanged: boolean;
}

/** かけ（後払い）で払える項目か */
export function canPayOnAccount(kind: RecordKind): boolean {
  return kind !== 'odometer' && !isWearKind(kind) && canBeOnAccount(kind);
}

function recordDate(target: EditTarget): string {
  switch (target.type) {
    case 'oil':
    case 'wear':
      return target.row.performed_on;
    case 'expense':
      return target.row.spent_on;
    case 'odometer':
      return target.row.read_on;
  }
}

/** 開いたときの値。編集ならその記録の値、新しい記録なら前回の同じ項目にそろえる */
export function initialValues(bundle: VehicleBundle, kind: RecordKind, unit: DistanceUnit, target: EditTarget | undefined, prefillNote: string | undefined): FormValues {
  const expenseRow = target?.type === 'oil' ? target.expense : target?.type === 'expense' ? target.row : null;
  const fuelRow = target?.type === 'expense' && target.row.category === 'fuel' ? target.row : null;
  // 新しい記録は、同じ項目の前回の記録と同じ支払い方法から始める（かけで給油する人が毎回選び直さなくてよいように）
  const lastSameKind = bundle.expenses.find((e) => e.category === kind);
  const paidOnAccount = (e: { on_account: boolean; fuel_price_basis: string | null } | undefined) => e?.on_account === true || e?.fuel_price_basis === 'tax_excluded';
  const amount = expenseRow == null ? null : expenseRow.on_account && expenseRow.entered_amount_yen != null ? expenseRow.entered_amount_yen : expenseRow.amount_yen;
  return {
    date: target ? recordDate(target) : bundle.today,
    odoText: target?.row.odo_km != null ? String(fromKm(target.row.odo_km, unit)) : '',
    amount: amount != null ? String(amount) : '',
    liters: fuelRow?.fuel_liters != null ? String(Number(fuelRow.fuel_liters)) : '',
    unitPrice: fuelRow?.fuel_unit_price != null ? String(Number(fuelRow.fuel_unit_price)) : '',
    // 油種は前回の給油と同じものから始める
    fuelType: fuelRow?.fuel_type ?? bundle.expenses.find((e) => e.category === 'fuel' && e.fuel_type)?.fuel_type ?? 'regular',
    onAccount: canPayOnAccount(kind) && (expenseRow ? paidOnAccount(expenseRow) : !target && paidOnAccount(lastSameKind)),
    exempt: expenseRow?.exempt_yen != null ? String(expenseRow.exempt_yen) : '',
    // 満タンは新しい記録ではオンから始める
    fullTank: fuelRow ? fuelRow.fuel_full_tank === true : true,
    note: target?.type === 'expense' || target?.type === 'wear' ? (target.row.note ?? '') : !target ? (prefillNote ?? '') : '',
    replaced: target?.type === 'wear' ? target.row.replaced : false,
    remaining: target?.type === 'wear' && target.row.remaining_mm != null ? String(Number(target.row.remaining_mm)) : '',
    filterChanged: target?.type === 'oil' ? target.row.filter_changed : false,
  };
}

/** 開いたときの金額が、給油量×単価の計算と違う（自分で入れた・レシートから読んだ）か。違えば計算で上書きしない */
export function initialAmountIsManual(v: FormValues): boolean {
  if (v.amount === '') return false;
  const liters = parseDecimal(v.liters, 2);
  const unitPrice = parseDecimal(v.unitPrice, 1);
  if (liters == null || unitPrice == null) return true;
  const basis = v.onAccount ? 'tax_excluded' : 'tax_included';
  return calculateFuelCost({ date: v.date, fuelType: v.fuelType, liters, unitPriceYen: unitPrice, basis }).totalYen !== Number(v.amount);
}

export function isDirty(current: FormValues, initial: FormValues): boolean {
  return (Object.keys(initial) as (keyof FormValues)[]).some((k) => current[k] !== initial[k]);
}

/** 走行距離の見込みを入れておく項目（走行距離を使う記録） */
const ODO_ESTIMATE_KINDS = new Set<RecordKind>(['oil_change', 'odometer', 'fuel', 'tire', 'brake']);

/** その日のメーターの見込み（km）。見込みを出さない項目や、記録が無ければ null */
export function estimateMeterKm(bundle: VehicleBundle, kind: RecordKind, date: string): number | null {
  const readings = bundle.state.readings;
  if (!ODO_ESTIMATE_KINDS.has(kind) || readings.length === 0) return null;
  return estimatedMeterReading(readings, toMeterReplacements(bundle.meterReplacements), dailyPace(readings, bundle.vehicle.annual_km_estimate), date);
}

/**
 * 自動車税・車検の重量税。車検証の項目（車両情報と周期）から計算する。
 * 県ごとの税率は、車検証の使用の本拠の位置の都道府県で決める
 */
export function recordTaxes(kind: RecordKind, vehicle: VehicleRow, certificate: VehicleCertificate | undefined, date: string) {
  const spec = { ...vehicleTaxSpec(vehicle), prefecture: certificate ? taxPrefecture(certificate) : null };
  const carTax = kind === 'car_tax' ? automobileTaxFor(spec, fiscalYearOf(date)) : null;
  const weightTax = kind === 'shaken' ? weightTaxFor(spec, date) : null;
  return {
    carTax,
    weightTax,
    specLabel: vehicleTaxSpecLabel(spec),
    specComplete: !!(spec.vehicleClass && spec.firstRegisteredOn && spec.powertrain),
    /** 税額を出したい項目なのに、計算できない */
    needsSpec: (kind === 'car_tax' && !carTax) || (kind === 'shaken' && !weightTax),
  };
}
