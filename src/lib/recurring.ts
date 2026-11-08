/**
 * 決まった支出の、画面で使う形（今日までに来た回・金額・表示名）。
 * 自動車税で金額を登録していなければ、車検証の内容から計算した税額を使う。
 */
import { EXPENSE_CATEGORY_LABELS } from '@domain/costs.ts';
import { dueOccurrences, nextOccurrence, type RecurringRule } from '@domain/recurring.ts';
import { automobileTaxFor, fiscalYearOf } from '@domain/vehicle-tax.ts';
import { vehicleTaxSpec } from '@shared/db-mapping.ts';
import type { IsoDate } from '@domain/dates.ts';
import type { RecurringBundle, RecurringCategory, RecurringExpenseRow, VehicleRow } from './data';

export const RECURRING_CATEGORIES: RecurringCategory[] = ['insurance', 'car_tax', 'parking_toll', 'loan_lease', 'maintenance', 'shaken', 'other'];

export function ruleOf(r: RecurringExpenseRow): RecurringRule {
  return { id: r.id, frequency: r.frequency, monthOfYear: r.month_of_year, dayOfMonth: r.day_of_month, startsOn: r.starts_on, endsOn: r.ends_on };
}

/** その回の金額。自動車税で金額が無ければ計算した税額、計算できなければ null */
export function amountFor(rule: RecurringExpenseRow, dueOn: IsoDate, vehicle: VehicleRow): number | null {
  if (rule.amount_yen != null) return rule.amount_yen;
  if (rule.category !== 'car_tax') return null;
  return automobileTaxFor(vehicleTaxSpec(vehicle), fiscalYearOf(dueOn))?.amountYen ?? null;
}

export function recurringLabel(rule: RecurringExpenseRow): string {
  return rule.note?.trim() || EXPENSE_CATEGORY_LABELS[rule.category];
}

export function scheduleLabel(rule: RecurringExpenseRow): string {
  return rule.frequency === 'monthly' ? `毎月${rule.day_of_month}日` : `毎年${rule.month_of_year}月${rule.day_of_month}日`;
}

export interface DueItem {
  rule: RecurringExpenseRow;
  dueOn: IsoDate;
  amountYen: number | null;
}

/** 今日までに来て、まだ記録・飛ばしをしていない回（古い順） */
export function dueItems(bundle: RecurringBundle, today: IsoDate, vehicle: VehicleRow): DueItem[] {
  return bundle.rules
    .flatMap((rule) =>
      dueOccurrences(ruleOf(rule), today, bundle.handled.get(rule.id) ?? new Set()).map((dueOn) => ({ rule, dueOn, amountYen: amountFor(rule, dueOn, vehicle) })),
    )
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));
}

export function nextDue(rule: RecurringExpenseRow, today: IsoDate): IsoDate | null {
  return nextOccurrence(ruleOf(rule), today);
}
