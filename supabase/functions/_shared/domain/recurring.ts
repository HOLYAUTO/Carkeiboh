/**
 * 毎月・毎年決まって払う支出の「回」。その日が来た回のうち、まだ記録も飛ばしもしていないものを出す。
 * 古い回がたまりすぎないよう、さかのぼるのは LOOKBACK_MONTHS か月まで。
 */
import { addMonths, type IsoDate } from './dates.ts';

export const LOOKBACK_MONTHS = 3;

export interface RecurringRule {
  id: string;
  frequency: 'monthly' | 'yearly';
  monthOfYear: number | null;
  dayOfMonth: number;
  startsOn: IsoDate;
  endsOn: IsoDate | null;
}

/** その月の day 日（無ければ月末） */
function dayInMonth(year: number, month: number, day: number): IsoDate {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** from 〜 to（両端を含む）の回の日付 */
export function occurrencesBetween(rule: RecurringRule, from: IsoDate, to: IsoDate): IsoDate[] {
  const start = rule.startsOn > from ? rule.startsOn : from;
  const end = rule.endsOn && rule.endsOn < to ? rule.endsOn : to;
  if (start > end) return [];
  const out: IsoDate[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endKey = end.slice(0, 7);
  while (`${y}-${String(m).padStart(2, '0')}` <= endKey) {
    if (rule.frequency === 'monthly' || rule.monthOfYear === m) {
      const d = dayInMonth(y, m, rule.dayOfMonth);
      if (d >= start && d <= end) out.push(d);
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** 今日までに来た回のうち、まだ記録・飛ばしをしていないもの（古い順） */
export function dueOccurrences(rule: RecurringRule, today: IsoDate, handled: ReadonlySet<IsoDate>): IsoDate[] {
  return occurrencesBetween(rule, addMonths(today, -LOOKBACK_MONTHS), today).filter((d) => !handled.has(d));
}

/** 次の回（今日より後でいちばん近い日）。無ければ null */
export function nextOccurrence(rule: RecurringRule, today: IsoDate): IsoDate | null {
  const upcoming = occurrencesBetween(rule, today, addMonths(today, 13)).filter((d) => d > today);
  return upcoming[0] ?? null;
}
