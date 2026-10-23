import { describe, expect, it } from 'vitest';
import { distanceInRange, summarizeCosts } from '../../supabase/functions/_shared/domain/costs.ts';

const expenses = [
  { date: '2025-12-20', amountYen: 30000, category: 'insurance' as const },
  { date: '2026-05-10', amountYen: 39500, category: 'car_tax' as const },
  { date: '2026-09-05', amountYen: 6000, category: 'fuel' as const },
  { date: '2026-10-03', amountYen: 5500, category: 'oil_change' as const },
  { date: '2026-10-15', amountYen: 6500, category: 'fuel' as const },
];
const readings = [
  { date: '2025-12-01', odoKm: 30000 },
  { date: '2026-09-30', odoKm: 38000 },
  { date: '2026-10-20', odoKm: 38800 },
];

describe('維持費の集計', () => {
  it('今月', () => {
    const s = summarizeCosts(expenses, readings, 'month', '2026-10-23');
    expect(s.from).toBe('2026-10-01');
    expect(s.totalYen).toBe(12000);
    expect(s.monthlyAverageYen).toBe(12000);
    expect(s.distanceKm).toBe(800);
    expect(s.perKmYen).toBe(15);
    expect(s.byMonth.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(s.byMonth.at(-1)?.totalYen).toBe(12000);
    expect(s.byCategory.map((c) => c.category)).toEqual(['fuel', 'oil_change']);
  });

  it('今年', () => {
    const s = summarizeCosts(expenses, readings, 'year', '2026-10-23');
    expect(s.totalYen).toBe(57500);
    expect(s.monthlyAverageYen).toBe(5750);
    // 年始直前の記録（2025-12-01 30,000km）から 38,800km まで
    expect(s.distanceKm).toBe(8800);
    expect(s.perKmYen).toBe(6.5);
    expect(s.byMonth).toHaveLength(10);
    expect(s.byCategory[0]).toMatchObject({ category: 'car_tax', totalYen: 39500 });
  });

  it('すべて', () => {
    const s = summarizeCosts(expenses, readings, 'all', '2026-10-23');
    expect(s.from).toBe('2025-12-01');
    expect(s.totalYen).toBe(87500);
    expect(s.monthlyAverageYen).toBe(Math.round(87500 / 11));
  });

  it('走行距離が分からなければ1kmあたりは出さない', () => {
    const s = summarizeCosts(expenses, [{ date: '2026-10-01', odoKm: 100 }], 'month', '2026-10-23');
    expect(s.perKmYen).toBeNull();
  });

  it('記録がなくても0で返す', () => {
    const s = summarizeCosts([], [], 'all', '2026-10-23');
    expect(s.totalYen).toBe(0);
    expect(s.monthlyAverageYen).toBe(0);
    expect(s.byCategory).toEqual([]);
  });

  it('期間の走行距離', () => {
    expect(distanceInRange(readings, '2026-10-01', '2026-10-23')).toBe(800);
    expect(distanceInRange(readings, '2027-01-01', '2027-01-31')).toBeNull();
  });
});
