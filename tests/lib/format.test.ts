import { describe, expect, it } from 'vitest';
import { km, parseDecimal, parseMillimeters } from '../../src/lib/format';

describe('溝・パッドの厚さ（mm）', () => {
  it.each([
    ['4', 4],
    ['3.5', 3.5],
    ['３．５', 3.5],
    ['1,6', 1.6],
    ['4mm', 4],
    ['4 ミリ', 4],
    ['3.', 3],
    ['.5', 0.5],
  ])('%s → %s', (text, mm) => {
    expect(parseMillimeters(text)).toBe(mm);
  });

  it('空なら null（任意の項目）', () => {
    expect(parseMillimeters('  ')).toBeNull();
  });

  it.each(['abc', '3.55', '123', '-1', '.', '1.2.3'])('%s は読めない', (text) => {
    expect(parseMillimeters(text)).toBeNaN();
  });
});

describe('parseDecimal（給油量・単価）', () => {
  it.each([
    ['32.15', 32.15],
    ['３２．１５', 32.15],
    ['172', 172],
    ['172.', 172],
    ['.5', 0.5],
    ['1,000.5', 1000.5],
  ])('%s → %s', (text, n) => {
    expect(parseDecimal(text, 2)).toBe(n);
  });

  it('桁の多すぎる小数・数でないものは NaN、空は null', () => {
    expect(parseDecimal('172.55', 1)).toBeNaN();
    expect(parseDecimal('abc', 2)).toBeNaN();
    expect(parseDecimal(' ', 2)).toBeNull();
  });
});

describe('km（車両の単位で書く）', () => {
  it('単位を渡さなければ km、mile なら換算する', () => {
    expect(km(41200)).toBe('41,200km');
    expect(km(66305, 'mile')).toBe('41,200mile');
  });
});
