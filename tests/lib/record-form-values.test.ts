import { describe, expect, it } from 'vitest';
import { initialAmountIsManual, initialValues, isDirty } from '../../src/components/record-form/values';
import type { ExpenseRow, VehicleBundle } from '../../src/lib/data';

function expense(patch: Partial<ExpenseRow>): ExpenseRow {
  return {
    id: 'e1',
    vehicle_id: 'v1',
    spent_on: '2026-11-01',
    category: 'fuel',
    amount_yen: 5000,
    odo_km: null,
    oil_change_id: null,
    note: null,
    fuel_liters: null,
    fuel_unit_price: null,
    fuel_type: null,
    fuel_price_basis: null,
    fuel_full_tank: null,
    on_account: false,
    entered_amount_yen: null,
    exempt_yen: null,
    created_at: '2026-11-01T00:00:00Z',
    ...patch,
  };
}

const bundle = (expenses: ExpenseRow[]) => ({ expenses, today: '2026-11-20' }) as unknown as VehicleBundle;

describe('initialValues', () => {
  it('新しい給油は今日・満タン・前回の油種から始める', () => {
    const v = initialValues(bundle([expense({ fuel_type: 'premium' })]), 'fuel', 'km', undefined, undefined);
    expect(v).toMatchObject({ date: '2026-11-20', odoText: '', amount: '', fuelType: 'premium', fullTank: true, onAccount: false });
  });
  it('前回の同じ項目がかけなら、かけから始める', () => {
    const v = initialValues(bundle([expense({ on_account: true })]), 'fuel', 'km', undefined, undefined);
    expect(v.onAccount).toBe(true);
  });
  it('かけで払えない項目は、前回がかけでもかけにしない', () => {
    const v = initialValues(bundle([expense({ category: 'insurance', on_account: true })]), 'insurance', 'km', undefined, undefined);
    expect(v.onAccount).toBe(false);
  });
  it('編集はその記録の値。かけの金額は入れた税抜の金額、走行距離は車両の単位', () => {
    const row = expense({ on_account: true, entered_amount_yen: 10000, amount_yen: 11000, odo_km: 16093, note: 'メモ', fuel_full_tank: false });
    const v = initialValues(bundle([row]), 'fuel', 'mile', { type: 'expense', row }, undefined);
    expect(v).toMatchObject({ date: '2026-11-01', amount: '10000', odoText: '10000', note: 'メモ', onAccount: true, fullTank: false });
  });
  it('新しい記録だけメモの下書きを入れる', () => {
    expect(initialValues(bundle([]), 'fuel', 'km', undefined, 'ENEOS').note).toBe('ENEOS');
  });
});

describe('initialAmountIsManual', () => {
  const base = initialValues(bundle([]), 'fuel', 'km', undefined, undefined);
  it('金額が空なら自動', () => {
    expect(initialAmountIsManual(base)).toBe(false);
  });
  it('給油量か単価が無ければ、入っている金額は自分で入れたもの', () => {
    expect(initialAmountIsManual({ ...base, amount: '5000' })).toBe(true);
  });
  it('給油量×単価の計算と同じなら自動、違えば自分で入れたもの', () => {
    const v = { ...base, date: '2026-11-01', liters: '30', unitPrice: '170' };
    expect(initialAmountIsManual({ ...v, amount: '5100' })).toBe(false);
    expect(initialAmountIsManual({ ...v, amount: '5000' })).toBe(true);
  });
});

describe('isDirty', () => {
  const base = initialValues(bundle([]), 'fuel', 'km', undefined, undefined);
  it('どれか1つでも変えたら入力途中', () => {
    expect(isDirty(base, base)).toBe(false);
    expect(isDirty({ ...base }, base)).toBe(false);
    expect(isDirty({ ...base, note: 'a' }, base)).toBe(true);
    expect(isDirty({ ...base, fullTank: false }, base)).toBe(true);
  });
});
