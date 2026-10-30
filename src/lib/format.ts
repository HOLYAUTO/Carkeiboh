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

/** タイヤの溝・ブレーキパッドの厚さ（mm、小数1桁まで）。全角・「，」の小数点も受ける。空なら null、読めなければ NaN */
export function parseMillimeters(text: string): number | null {
  const normalized = text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．，,]/g, '.')
    .replace(/\s|mm|ｍｍ|ミリ/gi, '');
  if (normalized === '') return null;
  if (!/^\d{1,2}(\.\d)?$/.test(normalized)) return NaN;
  return Number(normalized);
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** '2026-10-23' → '金' */
export function weekday(d: IsoDate): string {
  const [y, m, day] = d.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
}

/** '2026-10-23' → '10月23日（金）' */
export function longDate(d: IsoDate): string {
  const [, m, day] = d.split('-').map(Number);
  return `${m}月${day}日（${weekday(d)}）`;
}

/** 日時（ISO 8601）→ 日本時間の '2026/10/29 09:05' */
export function jstDateTime(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 日時（ISO 8601）→ 日本時間の日付と 'HH:MM'（入力欄に入れ直すため） */
export function jstParts(iso: string): { date: IsoDate; time: string } {
  const [date, time] = jstDateTime(iso).split(' ');
  return { date: date.replaceAll('/', '-'), time };
}

/** 日本時間の日付と 'HH:MM' → 日時（ISO 8601）。時刻の形が違えば null */
export function jstToIso(date: IsoDate, time: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim().replace('：', ':'));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return new Date(`${date}T${m[1].padStart(2, '0')}:${m[2]}:00+09:00`).toISOString();
}
