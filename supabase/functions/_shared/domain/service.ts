import { addDays, addMonths, diffDays, minDate, type IsoDate } from './dates.ts';
import type { OdoReading } from './odo.ts';
import { dailyPace, estimateOdoOn, type PaceBasis } from './pace.ts';

/** 周期。距離・期間のどちらかだけでもよい */
export interface ServiceInterval {
  km: number | null;
  months: number | null;
}

export const OIL_INTERVAL_KM_CHOICES = [3000, 5000, 10000] as const;
export const OIL_INTERVAL_MONTH_CHOICES = [3, 6, 9, 12] as const;
/** 【要確認】オイルの既定周期は依頼書に指定がないため仮の値 */
export const DEFAULT_OIL_INTERVAL: ServiceInterval = { km: 5000, months: 6 };
/** フィルターの既定距離は 10,000km（2026-10-23 確定）。期間は【要確認】の仮の値 */
export const DEFAULT_FILTER_INTERVAL: ServiceInterval = { km: 10000, months: 12 };

/** 前回の交換（ODO は実走行距離） */
export interface ServiceBaseline {
  date: IsoDate;
  odoKm: number;
}

export interface ServiceForecast {
  baseline: ServiceBaseline;
  /** 予定距離（前回ODO＋周期距離） */
  dueOdoKm: number | null;
  /** 今日の推定ODO */
  estimatedOdoKm: number;
  /** 予定距離までの推定残り（負なら超過） */
  remainingKm: number | null;
  /** 予定距離に達する予測日 */
  dateByDistance: IsoDate | null;
  /** 前回日付＋周期期間 */
  dateByTime: IsoDate | null;
  /** 次回の目安日（上の2つの早い方） */
  dueDate: IsoDate | null;
  dueReason: 'distance' | 'time' | null;
  /** 目安日までの日数（負なら超過） */
  remainingDays: number | null;
  /** 進み具合 0〜1（距離と期間の進んでいる方。超過時は1） */
  progress: number;
  paceBasis: PaceBasis;
  kmPerDay: number;
}

export interface ForecastInput {
  baseline: ServiceBaseline;
  interval: ServiceInterval;
  /** normalizeReadings 済みのODO記録（前回交換の記録も含めてよい） */
  readings: OdoReading[];
  annualKmEstimate: number;
  today: IsoDate;
}

export function forecastService(input: ForecastInput): ServiceForecast {
  const { baseline, interval, annualKmEstimate, today } = input;
  const readings = input.readings.some(
    (r) => r.date === baseline.date && r.odoKm === baseline.odoKm,
  )
    ? input.readings
    : [...input.readings, baseline].sort((a, b) =>
        a.date === b.date ? a.odoKm - b.odoKm : a.date < b.date ? -1 : 1,
      );

  const pace = dailyPace(readings, annualKmEstimate);
  const estimatedOdoKm = Math.max(estimateOdoOn(readings, pace, today) ?? baseline.odoKm, baseline.odoKm);
  const latest = readings[readings.length - 1];

  const dueOdoKm = interval.km != null ? baseline.odoKm + interval.km : null;
  const remainingKm = dueOdoKm != null ? dueOdoKm - estimatedOdoKm : null;

  let dateByDistance: IsoDate | null = null;
  if (dueOdoKm != null && pace.kmPerDay > 0) {
    const daysFromLatest = Math.ceil((dueOdoKm - latest.odoKm) / pace.kmPerDay);
    dateByDistance = addDays(latest.date, daysFromLatest);
  }
  const dateByTime = interval.months != null ? addMonths(baseline.date, interval.months) : null;

  let dueDate: IsoDate | null = null;
  let dueReason: ServiceForecast['dueReason'] = null;
  if (dateByDistance && dateByTime) {
    dueDate = minDate(dateByDistance, dateByTime);
    dueReason = dueDate === dateByDistance ? 'distance' : 'time';
  } else if (dateByDistance) {
    dueDate = dateByDistance;
    dueReason = 'distance';
  } else if (dateByTime) {
    dueDate = dateByTime;
    dueReason = 'time';
  }

  const ratios: number[] = [];
  if (interval.km) ratios.push((estimatedOdoKm - baseline.odoKm) / interval.km);
  if (dateByTime) {
    const total = diffDays(baseline.date, dateByTime);
    if (total > 0) ratios.push(diffDays(baseline.date, today) / total);
  }
  const progress = Math.min(1, Math.max(0, ...ratios, 0));

  return {
    baseline,
    dueOdoKm,
    estimatedOdoKm,
    remainingKm,
    dateByDistance,
    dateByTime,
    dueDate,
    dueReason,
    remainingDays: dueDate ? diffDays(today, dueDate) : null,
    progress,
    paceBasis: pace.basis,
    kmPerDay: pace.kmPerDay,
  };
}

export interface ServiceRecordLike {
  date: IsoDate;
  odoKm: number;
  oilChanged: boolean;
  filterChanged: boolean;
}

/** 最も新しい交換記録（オイル or フィルター）。ODO は実走行距離に揃えた値を渡すこと */
export function latestService<T extends ServiceRecordLike>(
  records: T[],
  part: 'oil' | 'filter',
): T | null {
  const hits = records.filter((r) => (part === 'oil' ? r.oilChanged : r.filterChanged));
  if (hits.length === 0) return null;
  return hits.reduce((a, b) =>
    b.date > a.date || (b.date === a.date && b.odoKm > a.odoKm) ? b : a,
  );
}
