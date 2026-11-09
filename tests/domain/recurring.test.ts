import { describe, expect, it } from 'vitest';
import { dueOccurrences, nextOccurrence, occurrencesBetween, type RecurringRule } from '../../supabase/functions/_shared/domain/recurring.ts';

const monthly: RecurringRule = { id: 'r1', frequency: 'monthly', monthOfYear: null, dayOfMonth: 27, startsOn: '2026-08-01', endsOn: null };
const yearly: RecurringRule = { id: 'r2', frequency: 'yearly', monthOfYear: 5, dayOfMonth: 31, startsOn: '2026-01-01', endsOn: null };

describe('occurrencesBetween', () => {
  it('毎月の回。31日などは月末にする', () => {
    expect(occurrencesBetween(monthly, '2026-08-01', '2026-11-08')).toEqual(['2026-08-27', '2026-09-27', '2026-10-27']);
    expect(occurrencesBetween({ ...monthly, dayOfMonth: 31 }, '2027-02-01', '2027-02-28')).toEqual(['2027-02-28']);
  });
  it('毎年の回', () => {
    expect(occurrencesBetween(yearly, '2026-01-01', '2027-12-31')).toEqual(['2026-05-31', '2027-05-31']);
  });
  it('始まりの日より前・終わりの日より後は出さない', () => {
    expect(occurrencesBetween({ ...monthly, endsOn: '2026-09-30' }, '2026-01-01', '2026-12-31')).toEqual(['2026-08-27', '2026-09-27']);
  });
});

describe('dueOccurrences', () => {
  it('記録・飛ばしをした回は出さず、さかのぼるのは3か月まで', () => {
    expect(dueOccurrences(monthly, '2026-11-08', new Set(['2026-09-27']))).toEqual(['2026-08-27', '2026-10-27'].filter((d) => d >= '2026-08-08'));
    expect(dueOccurrences({ ...monthly, startsOn: '2025-01-01' }, '2026-11-08', new Set())).toEqual(['2026-08-27', '2026-09-27', '2026-10-27']);
  });
  it('今日の回は出し、明日の回はまだ出さない', () => {
    expect(dueOccurrences(monthly, '2026-10-27', new Set())).toContain('2026-10-27');
    expect(dueOccurrences(monthly, '2026-10-26', new Set())).not.toContain('2026-10-27');
  });
});

describe('nextOccurrence', () => {
  it('今日より後でいちばん近い回', () => {
    expect(nextOccurrence(monthly, '2026-11-08')).toBe('2026-11-27');
    expect(nextOccurrence(yearly, '2026-06-01')).toBe('2027-05-31');
  });
});
