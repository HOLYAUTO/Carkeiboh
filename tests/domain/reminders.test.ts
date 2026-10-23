import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMINDER_SETTINGS,
  pendingNotifications,
  upcomingItems,
  type ReminderInput,
} from '../../supabase/functions/_shared/domain/reminders.ts';
import type { ServiceForecast } from '../../supabase/functions/_shared/domain/service.ts';

function forecast(partial: Partial<ServiceForecast>): ServiceForecast {
  return {
    baseline: { date: '2026-06-01', odoKm: 40000 },
    dueOdoKm: 45000,
    estimatedOdoKm: 43000,
    remainingKm: 2000,
    dateByDistance: '2026-12-01',
    dateByTime: '2026-12-01',
    dueDate: '2026-12-01',
    dueReason: 'time',
    remainingDays: 39,
    progress: 0.5,
    paceBasis: 'actual',
    kmPerDay: 20,
    ...partial,
  };
}

function input(partial: Partial<ReminderInput>): ReminderInput {
  return {
    vehicleName: 'N-BOX',
    today: '2026-10-23',
    settings: { ...DEFAULT_REMINDER_SETTINGS },
    oil: null,
    filter: null,
    deadlines: [],
    sentKeys: new Set(),
    ...partial,
  };
}

function keysOn(today: string, base: Partial<ReminderInput>, sent = new Set<string>()) {
  return pendingNotifications(input({ ...base, today, sentKeys: sent })).flatMap((n) => n.keys);
}

describe('オイル交換の通知', () => {
  const oil = { baselineId: 'oc1', forecast: forecast({ dueDate: '2026-12-01', remainingKm: 2000 }) };

  it('目安日の1か月前・2週間前・当日', () => {
    expect(keysOn('2026-10-31', { oil })).toEqual([]);
    expect(keysOn('2026-11-01', { oil })).toEqual(['oil:oc1:m1']);
    expect(keysOn('2026-11-17', { oil })).toEqual(['oil:oc1:w2']);
    expect(keysOn('2026-12-01', { oil })).toEqual(['oil:oc1:d0']);
  });

  it('送信済みの段階は送らない', () => {
    expect(keysOn('2026-11-02', { oil }, new Set(['oil:oc1:m1']))).toEqual([]);
  });

  it('推定の残りが500kmを切ったら通知。同じ日の期間の通知とは1件にまとめる', () => {
    const near = { baselineId: 'oc1', forecast: forecast({ remainingKm: 500, dueDate: '2026-11-15', remainingDays: 23 }) };
    const n = pendingNotifications(input({ oil: near, today: '2026-10-23' }));
    expect(n).toHaveLength(1);
    expect(n[0].keys).toEqual(['oil:oc1:km500', 'oil:oc1:m1']);
    expect(n[0].title).toBe('N-BOX：オイル交換の目安が近づいています');
    expect(n[0].body).toContain('推定であと500km');
    expect(n[0].body).toContain('あと23日');
  });

  it('予測日が飛んで目安日を過ぎても、当日分を1回だけ送る', () => {
    const late = { baselineId: 'oc1', forecast: forecast({ dueDate: '2026-10-20', remainingKm: -100, remainingDays: -3 }) };
    const n = pendingNotifications(input({ oil: late, sentKeys: new Set(['oil:oc1:km500']) }));
    expect(n[0].keys).toEqual(['oil:oc1:d0']);
    expect(n[0].title).toContain('目安を過ぎています');
    expect(keysOn('2026-10-24', { oil: late }, new Set(['oil:oc1:km500', 'oil:oc1:d0']))).toEqual([]);
  });

  it('交換し直すと新しい周期で通知し直す', () => {
    expect(keysOn('2026-11-01', { oil: { ...oil, baselineId: 'oc2' } }, new Set(['oil:oc1:m1']))).toEqual(['oil:oc2:m1']);
  });

  it('フィルターは独立して通知する', () => {
    const filter = { baselineId: 'oc0', forecast: forecast({ dueDate: '2026-12-01', remainingKm: 1200 }) };
    const n = pendingNotifications(input({ oil, filter, today: '2026-11-01' }));
    expect(n.map((x) => x.kind)).toEqual(['oil', 'filter']);
    expect(n[1].keys).toEqual(['filter:oc0:m1']);
  });

  it('オフにした項目は送らない', () => {
    expect(keysOn('2026-11-01', { oil, settings: { ...DEFAULT_REMINDER_SETTINGS, oil: false } })).toEqual([]);
  });
});

describe('期限の通知', () => {
  const shaken = { id: 's1', kind: 'shaken' as const, dueOn: '2027-03-15' };
  const insurance = { id: 'i1', kind: 'insurance' as const, dueOn: '2027-01-10' };
  const inspection = { id: 'p1', kind: 'inspection_legal' as const, dueOn: '2027-02-01' };

  it('車検：3か月前・2か月前・1か月前・7日前・当日', () => {
    const base = { deadlines: [shaken] };
    expect(keysOn('2026-12-14', base)).toEqual([]);
    expect(keysOn('2026-12-15', base)).toEqual(['shaken:s1:m3']);
    expect(keysOn('2027-01-15', base)).toEqual(['shaken:s1:m2']);
    expect(keysOn('2027-02-15', base)).toEqual(['shaken:s1:m1']);
    expect(keysOn('2027-03-08', base)).toEqual(['shaken:s1:d7']);
    expect(keysOn('2027-03-15', base)).toEqual(['shaken:s1:d0']);
    // 満了後の通知はしない（ホームの警告で知らせ続ける）
    expect(keysOn('2027-03-16', base)).toEqual([]);
  });

  it('保険：2か月前・1か月前・14日前・7日前・前日', () => {
    const base = { deadlines: [insurance] };
    expect(keysOn('2026-11-10', base)).toEqual(['insurance:i1:m2']);
    expect(keysOn('2026-12-10', base)).toEqual(['insurance:i1:m1']);
    expect(keysOn('2026-12-27', base)).toEqual(['insurance:i1:d14']);
    expect(keysOn('2027-01-03', base)).toEqual(['insurance:i1:d7']);
    expect(keysOn('2027-01-09', base)).toEqual(['insurance:i1:d1']);
    expect(keysOn('2027-01-10', base, new Set(['insurance:i1:d1']))).toEqual([]);
  });

  it('定期点検：2か月前・1か月前・7日前・当日', () => {
    const base = { deadlines: [inspection] };
    expect(keysOn('2026-12-01', base)).toEqual(['inspection_legal:p1:m2']);
    expect(keysOn('2027-01-25', base)).toEqual(['inspection_legal:p1:d7']);
    expect(keysOn('2027-02-01', base)).toEqual(['inspection_legal:p1:d0']);
  });

  it('後から登録した期限は、過ぎた段階のうち最新の1件だけ送る', () => {
    const n = pendingNotifications(input({ deadlines: [{ ...shaken, dueOn: '2026-11-02' }], today: '2026-10-23' }));
    expect(n.map((x) => x.keys)).toEqual([['shaken:s1:m1']]);
    expect(n[0].title).toBe('N-BOX：車検満了まであと10日');
  });

  it('自動車税は既定でオフ。オンなら5月1日に1回', () => {
    expect(keysOn('2027-05-01', {})).toEqual([]);
    const on = { settings: { ...DEFAULT_REMINDER_SETTINGS, car_tax: true } };
    expect(keysOn('2027-05-01', on)).toEqual(['car_tax:2027']);
    expect(keysOn('2027-05-01', on, new Set(['car_tax:2027']))).toEqual([]);
    expect(keysOn('2027-05-02', on)).toEqual([]);
  });
});

describe('ホームの「もうすぐの期限」', () => {
  it('近い順に並べ、満了を過ぎた車検は警告として残す', () => {
    const items = upcomingItems({
      today: '2026-10-23',
      oil: { baselineId: 'oc1', forecast: forecast({ dueDate: '2026-11-20' }) },
      filter: null,
      deadlines: [
        { id: 's1', kind: 'shaken', dueOn: '2026-10-01' },
        { id: 'i1', kind: 'insurance', dueOn: '2027-01-10' },
        { id: 'p1', kind: 'inspection_legal', dueOn: '2027-06-01' },
      ],
    });
    expect(items.map((i) => [i.kind, i.level, i.remainingDays])).toEqual([
      ['shaken', 'overdue', -22],
      ['oil', 'soon', 28],
      ['insurance', 'normal', 79],
    ]);
    expect(items[1].estimated).toBe(true);
  });
});
