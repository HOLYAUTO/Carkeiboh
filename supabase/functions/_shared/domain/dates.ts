/**
 * 日付は日本時間の暦日を 'YYYY-MM-DD' 文字列で扱う。
 * 端末やサーバーのタイムゾーンに左右されないよう、Date は UTC の0時として内部計算だけに使う。
 */
export type IsoDate = string;

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtcMs(date: IsoDate): number {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`日付の形式が不正です: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  return fromUtcMs(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) === value;
}

/** ある時点を日本時間の暦日に変換する */
export function toJstDate(instant: Date): IsoDate {
  return fromUtcMs(instant.getTime() + JST_OFFSET_MS);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** 月を加減する。移動先の月に同じ日がなければ月末に寄せる（例：3/31 の1か月前 → 2/28） */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const d = new Date(toUtcMs(date));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fromUtcMs(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)));
}

/** from から to までの日数（to が後なら正） */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

/** 'YYYY-MM' */
export function monthKey(date: IsoDate): string {
  return date.slice(0, 7);
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function startOfYear(date: IsoDate): IsoDate {
  return `${date.slice(0, 4)}-01-01`;
}

/** from と to を含む月数（同じ月なら1） */
export function monthsInclusive(from: IsoDate, to: IsoDate): number {
  const fy = Number(from.slice(0, 4));
  const fm = Number(from.slice(5, 7));
  const ty = Number(to.slice(0, 4));
  const tm = Number(to.slice(5, 7));
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/** 表示用：残り日数 → 'あと3日'／'今日'／'2日超過'（色だけで状態を伝えないよう、必ず文字でも書く） */
export function formatDaysLeft(days: number): string {
  if (days > 0) return `あと${days}日`;
  if (days === 0) return '今日';
  return `${-days}日超過`;
}

/** 表示用：'2026-11-04' → '11/04' */
export function formatMonthDay(date: IsoDate): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`;
}
