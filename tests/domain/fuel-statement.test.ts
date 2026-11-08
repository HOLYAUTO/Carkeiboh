import { describe, expect, it } from 'vitest';
import { matchesExistingFill, rowTotalYen, sanitizeStatement } from '../../supabase/functions/_shared/fuel-statement.ts';
import { calculateFuelCost } from '../../supabase/functions/_shared/domain/fuel.ts';

describe('sanitizeStatement（掛けカードの明細）', () => {
  it('行の形を確かめ、日付の順に並べる。単価は既定で税抜', () => {
    const s = sanitizeStatement(
      {
        rows: [
          { date: '2026-10-21', station: '　ENEOS 本町SS ', fuel_type: 'diesel', liters: '45.30', unit_price: 128.4, amount_yen: 5816 },
          { date: '2026-10-03', station: null, fuel_type: 'regular', liters: 30, unit_price: 150, amount_yen: null },
          { date: '2026-10-40', fuel_type: 'regular', liters: 20 },
          { date: '2027-01-01', fuel_type: 'regular', liters: 20 },
          { date: '2026-10-05', fuel_type: 'gas', liters: null, amount_yen: null },
        ],
        total_yen: '13,000',
      },
      '2026-11-08',
    );
    expect(s.basis).toBe('tax_excluded');
    expect(s.totalYen).toBe(13000);
    expect(s.rows).toEqual([
      { date: '2026-10-03', station: null, fuelType: 'regular', liters: 30, unitPrice: 150, amountYen: null },
      { date: '2026-10-21', station: 'ENEOS 本町SS', fuelType: 'diesel', liters: 45.3, unitPrice: 128.4, amountYen: 5816 },
    ]);
  });
  it('明細の単価が税込と読めたら税込として扱う', () => {
    expect(sanitizeStatement({ rows: [], unit_price_includes_tax: true }, '2026-11-08').basis).toBe('tax_included');
  });
});

describe('rowTotalYen', () => {
  it('給油量と単価があれば、税抜の単価から税込を計算する', () => {
    const row = { date: '2026-10-21', station: null, fuelType: 'diesel' as const, liters: 45.3, unitPrice: 128.4, amountYen: 5816 };
    expect(rowTotalYen(row, 'tax_excluded')).toBe(
      calculateFuelCost({ date: '2026-10-21', fuelType: 'diesel', liters: 45.3, unitPriceYen: 128.4, basis: 'tax_excluded' }).totalYen,
    );
  });
  it('量が無ければ行の金額（税抜なら消費税を足す）', () => {
    const row = { date: '2026-10-21', station: null, fuelType: null, liters: null, unitPrice: null, amountYen: 5000 };
    expect(rowTotalYen(row, 'tax_excluded')).toBe(5500);
    expect(rowTotalYen(row, 'tax_included')).toBe(5000);
  });
});

describe('matchesExistingFill', () => {
  const existing = [{ date: '2026-10-21', liters: 45.32, amountYen: 6800 }];
  it('同じ日で量がほぼ同じなら登録済み', () => {
    expect(matchesExistingFill({ date: '2026-10-21', station: null, fuelType: null, liters: 45.3, unitPrice: null, amountYen: null }, null, existing)).toBe(true);
    expect(matchesExistingFill({ date: '2026-10-22', station: null, fuelType: null, liters: 45.3, unitPrice: null, amountYen: null }, null, existing)).toBe(false);
  });
  it('量が分からなければ金額で見る', () => {
    expect(matchesExistingFill({ date: '2026-10-21', station: null, fuelType: null, liters: null, unitPrice: null, amountYen: 6182 }, 6800, existing)).toBe(true);
  });
});
