import { describe, expect, it } from 'vitest';
import { parseMillimeters } from '../../src/lib/format';

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
