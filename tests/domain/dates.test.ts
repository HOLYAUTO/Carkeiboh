import { describe, expect, it } from 'vitest';
import { addDays, addMonths, diffDays, isIsoDate, monthsInclusive, toJstDate } from '../../supabase/functions/_shared/domain/dates.ts';

describe('dates', () => {
  it('日本時間の暦日に変換する（UTC 15:00 以降は翌日）', () => {
    expect(toJstDate(new Date('2026-10-23T14:59:59Z'))).toBe('2026-10-23');
    expect(toJstDate(new Date('2026-10-23T15:00:00Z'))).toBe('2026-10-24');
  });

  it('月の加減は月末に寄せる', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2028-03-31', -1)).toBe('2028-02-29');
    expect(addMonths('2026-10-23', 6)).toBe('2027-04-23');
    expect(addMonths('2026-01-15', -3)).toBe('2025-10-15');
  });

  it('日数の加減と差', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-10-23', '2026-11-04')).toBe(12);
    expect(diffDays('2026-11-04', '2026-10-23')).toBe(-12);
  });

  it('月数（両端を含む）', () => {
    expect(monthsInclusive('2026-10-01', '2026-10-23')).toBe(1);
    expect(monthsInclusive('2026-01-01', '2026-10-23')).toBe(10);
    expect(monthsInclusive('2025-11-01', '2026-02-01')).toBe(4);
  });

  it('存在しない日付は不正', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026/02/28')).toBe(false);
  });
});
