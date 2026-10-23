import { monthKey, monthsInclusive, startOfMonth, startOfYear, addMonths, type IsoDate } from './dates.ts';
import type { OdoReading } from './odo.ts';

export const EXPENSE_CATEGORIES = [
  'oil_change',
  'fuel',
  'maintenance',
  'shaken',
  'insurance',
  'car_tax',
  'parking_toll',
  'loan_lease',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  oil_change: 'オイル交換',
  fuel: '給油',
  maintenance: '整備・修理',
  shaken: '車検',
  insurance: '自動車保険',
  car_tax: '自動車税',
  parking_toll: '駐車場・高速',
  loan_lease: 'ローン・リース',
  other: 'その他',
};

export interface ExpenseLike {
  date: IsoDate;
  amountYen: number;
  category: ExpenseCategory;
}

export type CostPeriod = 'month' | 'year' | 'all';

export interface CostSummary {
  period: CostPeriod;
  from: IsoDate;
  to: IsoDate;
  /** 登録済みの合計（記録漏れがありうるので画面では必ずこの言い方をする） */
  totalYen: number;
  monthlyAverageYen: number;
  /** 期間の合計 ÷ 期間の走行距離。走行距離が分からなければ null */
  perKmYen: number | null;
  distanceKm: number | null;
  byMonth: { month: string; totalYen: number }[];
  byCategory: { category: ExpenseCategory; totalYen: number; ratio: number }[];
}

/** 当月表示でも推移が見えるよう、棒グラフは直近6か月を出す */
const MONTH_VIEW_CHART_MONTHS = 6;

function odoAtOrBefore(readings: OdoReading[], date: IsoDate): OdoReading | undefined {
  return readings.filter((r) => r.date <= date).at(-1);
}

/** 期間の走行距離。期間開始直前の記録（なければ期間内の最初の記録）から、期間内最後の記録まで */
export function distanceInRange(readings: OdoReading[], from: IsoDate, to: IsoDate): number | null {
  const end = odoAtOrBefore(readings, to);
  const start = readings.filter((r) => r.date < from).at(-1) ?? readings.find((r) => r.date >= from);
  if (!start || !end) return null;
  const km = end.odoKm - start.odoKm;
  return km > 0 ? km : null;
}

/**
 * 維持費の集計。readings は normalizeReadings 済みであること。
 * 二重計上はデータ側で防ぐ（オイル交換の金額は expenses に1件だけ持つ）。
 */
export function summarizeCosts(
  expenses: ExpenseLike[],
  readings: OdoReading[],
  period: CostPeriod,
  today: IsoDate,
): CostSummary {
  const firstExpense = expenses.reduce<IsoDate | null>(
    (min, e) => (min == null || e.date < min ? e.date : min),
    null,
  );
  const from =
    period === 'month'
      ? startOfMonth(today)
      : period === 'year'
        ? startOfYear(today)
        : startOfMonth(firstExpense ?? today);
  const to = today;

  const inRange = expenses.filter((e) => e.date >= from && e.date <= to);
  const totalYen = inRange.reduce((sum, e) => sum + e.amountYen, 0);
  const months = monthsInclusive(from, to);
  const distanceKm = distanceInRange(readings, from, to);

  const chartFrom =
    period === 'month' ? addMonths(startOfMonth(today), -(MONTH_VIEW_CHART_MONTHS - 1)) : from;
  const byMonth: CostSummary['byMonth'] = [];
  for (let i = 0; i < monthsInclusive(chartFrom, to); i++) {
    const month = monthKey(addMonths(chartFrom, i));
    byMonth.push({
      month,
      totalYen: expenses
        .filter((e) => monthKey(e.date) === month && e.date <= to)
        .reduce((sum, e) => sum + e.amountYen, 0),
    });
  }

  const categoryTotals = new Map<ExpenseCategory, number>();
  for (const e of inRange) {
    categoryTotals.set(e.category, (categoryTotals.get(e.category) ?? 0) + e.amountYen);
  }
  const byCategory = [...categoryTotals.entries()]
    .map(([category, sum]) => ({ category, totalYen: sum, ratio: totalYen > 0 ? sum / totalYen : 0 }))
    .sort((a, b) => b.totalYen - a.totalYen);

  return {
    period,
    from,
    to,
    totalYen,
    monthlyAverageYen: Math.round(totalYen / months),
    perKmYen: distanceKm ? Math.round((totalYen / distanceKm) * 10) / 10 : null,
    distanceKm,
    byMonth,
    byCategory,
  };
}
