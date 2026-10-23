import { diffDays, type IsoDate } from './dates.ts';

export interface OdoReading {
  date: IsoDate;
  odoKm: number;
}

/** メーター交換の訂正履歴。交換後の読みに (odoBeforeKm - odoAfterKm) を足して実走行距離に揃える */
export interface MeterReplacement {
  replacedOn: IsoDate;
  /** 交換前メーターの最終値 */
  odoBeforeKm: number;
  /** 交換後メーターの開始値 */
  odoAfterKm: number;
}

/** 1日あたりこれを超えて増えた値は確認を出す（2026-10-23 確定） */
export const MAX_KM_PER_DAY = 1000;

function isAfterReplacement(reading: OdoReading, r: MeterReplacement): boolean {
  if (reading.date > r.replacedOn) return true;
  // 交換当日は、交換前の最終値より小さい読みを新しいメーターの値とみなす
  return reading.date === r.replacedOn && reading.odoKm < r.odoBeforeKm;
}

/** メーター交換を考慮した実走行距離 */
export function effectiveOdo(reading: OdoReading, replacements: MeterReplacement[]): number {
  let offset = 0;
  for (const r of replacements) {
    if (isAfterReplacement(reading, r)) offset += r.odoBeforeKm - r.odoAfterKm;
  }
  return reading.odoKm + offset;
}

/** 実走行距離に揃え、日付・距離の順に並べる */
export function normalizeReadings(
  readings: OdoReading[],
  replacements: MeterReplacement[] = [],
): OdoReading[] {
  return readings
    .map((r) => ({ date: r.date, odoKm: effectiveOdo(r, replacements) }))
    .sort((a, b) => (a.date === b.date ? a.odoKm - b.odoKm : a.date < b.date ? -1 : 1));
}

export type OdoWarningCode = 'lower_than_previous' | 'too_fast';

export interface OdoWarning {
  code: OdoWarningCode;
  message: string;
}

/**
 * 登録前の確認。登録自体は止めない（警告を返すだけ）。
 * 比較対象は、入力日以前で最も新しい記録。
 */
export function checkOdoEntry(
  candidate: OdoReading,
  readings: OdoReading[],
  replacements: MeterReplacement[] = [],
): OdoWarning[] {
  const normalized = normalizeReadings(readings, replacements);
  const previous = normalized.filter((r) => r.date <= candidate.date).at(-1);
  if (!previous) return [];

  const value = effectiveOdo(candidate, replacements);
  if (value < previous.odoKm) {
    return [
      {
        code: 'lower_than_previous',
        message: `前回の記録（${previous.odoKm.toLocaleString('ja-JP')}km）より小さい値です。メーターを交換した場合は、設定から「メーター交換」を登録してください。`,
      },
    ];
  }
  const days = Math.max(1, diffDays(previous.date, candidate.date));
  if ((value - previous.odoKm) / days > MAX_KM_PER_DAY) {
    return [
      {
        code: 'too_fast',
        message: `前回の記録から1日あたり${MAX_KM_PER_DAY.toLocaleString('ja-JP')}kmを超えて増えています。入力に誤りがないか確認してください。`,
      },
    ];
  }
  return [];
}
