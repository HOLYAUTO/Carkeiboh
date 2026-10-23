import { addDays, diffDays, type IsoDate } from './dates.ts';
import type { OdoReading } from './odo.ts';

export type PaceBasis = 'actual' | 'annual_estimate';

export interface Pace {
  kmPerDay: number;
  basis: PaceBasis;
}

/** 実績ペースは直近1年の記録から計算する（古い走り方に引きずられないため） */
export const PACE_WINDOW_DAYS = 365;

/**
 * 走行ペース。ODOの記録が2件以上（別の日）あれば実績から、なければ初回設定の年間走行距離から求める。
 * readings は normalizeReadings 済み（実走行距離・昇順）であること。
 */
export function dailyPace(readings: OdoReading[], annualKmEstimate: number): Pace {
  const fallback: Pace = { kmPerDay: Math.max(0, annualKmEstimate) / 365, basis: 'annual_estimate' };
  if (readings.length < 2) return fallback;

  const last = readings[readings.length - 1];
  const windowStart = addDays(last.date, -PACE_WINDOW_DAYS);
  const recent = readings.filter((r) => r.date >= windowStart);
  const points = recent.length >= 2 && recent[0].date < last.date ? recent : readings;
  const first = points[0];

  const days = diffDays(first.date, last.date);
  const km = last.odoKm - first.odoKm;
  if (days <= 0 || km <= 0) return fallback;
  return { kmPerDay: km / days, basis: 'actual' };
}

/** 今日時点の推定ODO（最後の記録＋ペース×経過日数） */
export function estimateOdoOn(readings: OdoReading[], pace: Pace, date: IsoDate): number | null {
  const last = readings.at(-1);
  if (!last) return null;
  const days = Math.max(0, diffDays(last.date, date));
  return Math.round(last.odoKm + pace.kmPerDay * days);
}
