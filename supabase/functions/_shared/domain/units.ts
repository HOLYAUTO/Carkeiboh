/**
 * 距離の単位。DB と計算はすべて km で持ち、画面の入力と表示だけを車両の単位（km / mile）にする。
 * メーターが mile の輸入車などのため（2026-11-05 の要望）。
 */
export const DISTANCE_UNITS = ['km', 'mile'] as const;
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];

/** 1 mile = 1.609344 km（国際マイル） */
export const KM_PER_MILE = 1.609344;

export function isDistanceUnit(value: unknown): value is DistanceUnit {
  return value === 'km' || value === 'mile';
}

/** 画面に出す単位の書き方 */
export function distanceUnitLabel(unit: DistanceUnit): string {
  return unit === 'mile' ? 'mile' : 'km';
}

/**
 * 車両の単位の値 → km（整数）。km は mile より細かいので、mile → km → mile と戻しても値は変わらない
 */
export function toKm(value: number, unit: DistanceUnit): number {
  return unit === 'mile' ? Math.round(value * KM_PER_MILE) : Math.round(value);
}

/** km → 車両の単位の値（整数） */
export function fromKm(km: number, unit: DistanceUnit): number {
  return unit === 'mile' ? Math.round(km / KM_PER_MILE) : Math.round(km);
}

/** km の値を車両の単位で「41,200km」「25,600mile」のように書く */
export function formatDistance(km: number, unit: DistanceUnit = 'km'): string {
  return `${fromKm(km, unit).toLocaleString('ja-JP')}${distanceUnitLabel(unit)}`;
}
