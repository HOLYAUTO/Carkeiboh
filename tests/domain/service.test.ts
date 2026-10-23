import { describe, expect, it } from 'vitest';
import { dailyPace } from '../../supabase/functions/_shared/domain/pace.ts';
import { forecastService, latestService } from '../../supabase/functions/_shared/domain/service.ts';

describe('走行ペース', () => {
  it('記録が1件以下なら年間走行距離の目安を使う', () => {
    const p = dailyPace([{ date: '2026-10-01', odoKm: 40000 }], 7300);
    expect(p.basis).toBe('annual_estimate');
    expect(p.kmPerDay).toBeCloseTo(20);
  });

  it('記録が2件以上あれば実績から計算する', () => {
    const p = dailyPace(
      [
        { date: '2026-09-01', odoKm: 40000 },
        { date: '2026-10-01', odoKm: 41500 },
      ],
      7300,
    );
    expect(p.basis).toBe('actual');
    expect(p.kmPerDay).toBeCloseTo(50);
  });

  it('同じ日の2件だけ・距離が増えていない場合は目安を使う', () => {
    expect(
      dailyPace(
        [
          { date: '2026-10-01', odoKm: 40000 },
          { date: '2026-10-01', odoKm: 40010 },
        ],
        3650,
      ).basis,
    ).toBe('annual_estimate');
  });

  it('直近1年の記録を優先する', () => {
    const p = dailyPace(
      [
        { date: '2024-01-01', odoKm: 0 },
        { date: '2025-11-01', odoKm: 60000 },
        { date: '2026-10-28', odoKm: 63600 },
      ],
      10000,
    );
    // 2025-11-01 → 2026-10-28 の 361日で 3,600km
    expect(p.kmPerDay).toBeCloseTo(3600 / 361);
  });
});

describe('次回の目安（距離と期間の早い方）', () => {
  const baseline = { date: '2026-06-01', odoKm: 40000 };

  it('距離が先に来る場合', () => {
    // 実績ペース 50km/日。5,000km は 100日後 = 2026-09-09。期間6か月 = 2026-12-01
    const f = forecastService({
      baseline,
      interval: { km: 5000, months: 6 },
      readings: [baseline, { date: '2026-07-01', odoKm: 41500 }],
      annualKmEstimate: 5000,
      today: '2026-08-01',
    });
    expect(f.dueOdoKm).toBe(45000);
    expect(f.dateByDistance).toBe('2026-09-09');
    expect(f.dateByTime).toBe('2026-12-01');
    expect(f.dueDate).toBe('2026-09-09');
    expect(f.dueReason).toBe('distance');
    expect(f.estimatedOdoKm).toBe(43050); // 41,500 + 50×31
    expect(f.remainingKm).toBe(1950);
    expect(f.remainingDays).toBe(39);
    expect(f.paceBasis).toBe('actual');
    expect(f.progress).toBeCloseTo(3050 / 5000);
  });

  it('期間が先に来る場合（あまり走らない人）', () => {
    // 年間 3,650km の目安 → 10km/日。5,000km は 500日後。期間6か月が先
    const f = forecastService({
      baseline,
      interval: { km: 5000, months: 6 },
      readings: [baseline],
      annualKmEstimate: 3650,
      today: '2026-11-01',
    });
    expect(f.paceBasis).toBe('annual_estimate');
    expect(f.dateByDistance).toBe('2027-10-14');
    expect(f.dueDate).toBe('2026-12-01');
    expect(f.dueReason).toBe('time');
    expect(f.remainingDays).toBe(30);
    expect(f.estimatedOdoKm).toBe(41530);
    expect(f.remainingKm).toBe(3470);
    // 期間の進み具合（153/183日）の方が進んでいる
    expect(f.progress).toBeCloseTo(153 / 183);
  });

  it('超過した場合は残りが負、進み具合は1', () => {
    const f = forecastService({
      baseline,
      interval: { km: 3000, months: 3 },
      readings: [baseline, { date: '2026-10-01', odoKm: 44000 }],
      annualKmEstimate: 10000,
      today: '2026-10-11',
    });
    expect(f.remainingKm).toBeLessThan(0);
    expect(f.remainingDays).toBeLessThan(0);
    expect(f.progress).toBe(1);
  });

  it('距離だけ・期間だけの周期にも対応する', () => {
    const kmOnly = forecastService({
      baseline,
      interval: { km: 10000, months: null },
      readings: [baseline],
      annualKmEstimate: 7300,
      today: '2026-06-01',
    });
    expect(kmOnly.dueReason).toBe('distance');
    expect(kmOnly.dateByTime).toBeNull();
    expect(kmOnly.dateByDistance).toBe('2027-10-14'); // 20km/日で500日後

    const timeOnly = forecastService({
      baseline,
      interval: { km: null, months: 12 },
      readings: [baseline],
      annualKmEstimate: 7300,
      today: '2026-06-01',
    });
    expect(timeOnly.dueReason).toBe('time');
    expect(timeOnly.remainingKm).toBeNull();
    expect(timeOnly.dueDate).toBe('2027-06-01');
  });

  it('前回交換より後に記録がなくても、前回交換の時点から推定する', () => {
    const f = forecastService({
      baseline: { date: '2026-10-01', odoKm: 50000 },
      interval: { km: 5000, months: 6 },
      readings: [{ date: '2026-09-01', odoKm: 49000 }],
      annualKmEstimate: 3650,
      today: '2026-10-11',
    });
    // 9/1→10/1 で 1,000km = 33.3km/日
    expect(f.paceBasis).toBe('actual');
    expect(f.estimatedOdoKm).toBe(50333);
  });
});

describe('最新の交換記録', () => {
  const records = [
    { id: 'a', date: '2026-01-10', odoKm: 30000, oilChanged: true, filterChanged: true },
    { id: 'b', date: '2026-06-01', odoKm: 35000, oilChanged: true, filterChanged: false },
    { id: 'c', date: '2026-08-01', odoKm: 37000, oilChanged: false, filterChanged: false },
  ];
  it('オイルとフィルターを別々に探す', () => {
    expect(latestService(records, 'oil')?.id).toBe('b');
    expect(latestService(records, 'filter')?.id).toBe('a');
    expect(latestService([], 'oil')).toBeNull();
  });
});
