import { describe, expect, it } from 'vitest';
import { dailyPace, estimatedMeterReading } from '../../supabase/functions/_shared/domain/pace.ts';
import { normalizeReadings } from '../../supabase/functions/_shared/domain/odo.ts';

describe('estimatedMeterReading（入力欄に入れておく走行距離の見込み）', () => {
  it('最後の記録＋ペース×日数', () => {
    const readings = [
      { date: '2026-01-01', odoKm: 10000 },
      { date: '2026-11-01', odoKm: 13040 },
    ];
    const pace = dailyPace(readings, 8000);
    expect(estimatedMeterReading(readings, [], pace, '2026-11-11')).toBe(13040 + Math.round(10 * (3040 / 304)));
  });
  it('メーターを交換していたら、表示の値に戻す', () => {
    const replacements = [{ replacedOn: '2026-06-01', odoBeforeKm: 50000, odoAfterKm: 0 }];
    const readings = normalizeReadings(
      [
        { date: '2026-01-01', odoKm: 48000 },
        { date: '2026-11-01', odoKm: 3000 },
      ],
      replacements,
    );
    const pace = dailyPace(readings, 8000);
    const est = estimatedMeterReading(readings, replacements, pace, '2026-11-01');
    expect(est).toBe(3000);
  });
  it('記録が無ければ出さない', () => {
    expect(estimatedMeterReading([], [], { kmPerDay: 20, basis: 'annual_estimate' }, '2026-11-01')).toBeNull();
  });
});
