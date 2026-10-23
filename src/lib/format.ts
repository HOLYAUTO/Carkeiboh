import { formatMonthDay, type IsoDate } from '@domain/dates.ts';

export function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}

export function km(n: number): string {
  return `${Math.round(n).toLocaleString('ja-JP')}km`;
}

export function number(n: number): string {
  return Math.round(n).toLocaleString('ja-JP');
}

/** '2026-10-23' → '2026/10/23' */
export function fullDate(d: IsoDate): string {
  return d.replaceAll('-', '/');
}

export { formatMonthDay as monthDay };

/** 色だけで状態を伝えないよう、残り日数は必ず文字でも書く */
export function daysLeft(days: number): string {
  if (days > 0) return `あと${days}日`;
  if (days === 0) return '今日';
  return `${-days}日超過`;
}

/** 端末のローカル日付 ↔ 'YYYY-MM-DD' */
export function dateToIso(d: Date): IsoDate {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function isoToDate(d: IsoDate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}

/** 全角数字・カンマを許して整数にする。空なら null */
export function parseInteger(text: string): number | null {
  const normalized = text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s]/g, '');
  if (normalized === '') return null;
  if (!/^\d+$/.test(normalized)) return NaN;
  return Number(normalized);
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** '2026-10-23' → '10月23日（金）' */
export function longDate(d: IsoDate): string {
  const [y, m, day] = d.split('-').map(Number);
  const w = WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
  return `${m}月${day}日（${w}）`;
}
