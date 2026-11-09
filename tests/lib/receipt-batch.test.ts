import { describe, expect, it } from 'vitest';
import { batchStatus, isDuplicate } from '../../src/lib/receipt-batch';

describe('batchStatus', () => {
  it('項目・日付・金額がそろえばそのまま登録できる', () => {
    expect(batchStatus({ category: 'fuel', date: '2026-11-01', amountYen: 5000 })).toBe('ready');
    expect(batchStatus({ category: 'parking_toll', date: '2026-11-01', amountYen: 800 })).toBe('ready');
  });
  it('足りなければ開いて入力。オイル交換・走行距離は走行距離が要るので開いて入力', () => {
    expect(batchStatus({ category: 'fuel', amountYen: 5000 })).toBe('needs_input');
    expect(batchStatus({ date: '2026-11-01', amountYen: 5000 })).toBe('needs_input');
    expect(batchStatus({ category: 'oil_change', date: '2026-11-01', amountYen: 5000 })).toBe('needs_input');
    expect(batchStatus({ category: 'odometer', odo: 41200 })).toBe('needs_input');
  });
  it('何も読めなければ読み取れなかった', () => {
    expect(batchStatus({})).toBe('unreadable');
    expect(batchStatus(null)).toBe('unreadable');
  });
});

describe('isDuplicate', () => {
  it('同じ項目・日・金額なら登録済み', () => {
    const existing = [{ category: 'fuel' as const, spent_on: '2026-11-01', amount_yen: 5000 }];
    expect(isDuplicate({ category: 'fuel', date: '2026-11-01', amountYen: 5000 }, existing)).toBe(true);
    expect(isDuplicate({ category: 'fuel', date: '2026-11-02', amountYen: 5000 }, existing)).toBe(false);
  });
});
