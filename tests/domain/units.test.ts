import { describe, expect, it } from 'vitest';
import { formatDistance, fromKm, toKm } from '../../supabase/functions/_shared/domain/units.ts';

describe('距離の単位', () => {
  it('mile を km に直す（整数に丸める）', () => {
    expect(toKm(100, 'mile')).toBe(161);
    expect(toKm(41200, 'mile')).toBe(66305);
    expect(toKm(41200, 'km')).toBe(41200);
  });

  it('mile → km → mile と戻しても値が変わらない', () => {
    for (const mi of [0, 1, 2, 3, 999, 12345, 41200, 99999, 654321]) {
      expect(fromKm(toKm(mi, 'mile'), 'mile')).toBe(mi);
    }
  });

  it('車両の単位で書く', () => {
    expect(formatDistance(66305, 'mile')).toBe('41,200mile');
    expect(formatDistance(41200)).toBe('41,200km');
  });
});
