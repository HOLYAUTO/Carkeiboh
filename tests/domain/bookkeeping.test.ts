import { describe, expect, it } from 'vitest';
import {
  annualBookkeeping,
  bookkeepingCsv,
  bookkeepingLine,
  canBeOnAccount,
  consumptionTaxPercentOn,
  defaultBookkeepingYear,
  withConsumptionTax,
  type BookkeepingExpense,
} from '../../supabase/functions/_shared/domain/bookkeeping.ts';
import { calculateFuelCost } from '../../supabase/functions/_shared/domain/fuel.ts';

const base: BookkeepingExpense = {
  date: '2026-06-01',
  category: 'maintenance',
  amountYen: 11000,
  onAccount: false,
  enteredAmountYen: null,
  exemptYen: null,
  fuel: null,
  note: null,
};

describe('consumptionTaxPercentOn', () => {
  it('2019-10-01 から 10%、その前は 8%', () => {
    expect(consumptionTaxPercentOn('2019-09-30')).toBe(8);
    expect(consumptionTaxPercentOn('2019-10-01')).toBe(10);
    expect(consumptionTaxPercentOn('2014-03-31')).toBe(5);
  });
});

describe('withConsumptionTax（かけの税抜から税込へ）', () => {
  it('消費税は1円未満切り捨て', () => {
    expect(withConsumptionTax(10005, '2026-06-01')).toEqual({ totalYen: 11005, consumptionTaxYen: 1000 });
  });
  it('消費税のかからない分（車検の法定費用）には税を足さない', () => {
    // 整備 50,000円＋法定費用 30,000円（税抜 80,000円として入力）
    expect(withConsumptionTax(80000, '2026-06-01', 30000)).toEqual({ totalYen: 85000, consumptionTaxYen: 5000 });
  });
});

describe('canBeOnAccount', () => {
  it('かけは掛けカードでの給油だけ', () => {
    expect(canBeOnAccount('fuel')).toBe(true);
    expect(canBeOnAccount('maintenance')).toBe(false);
    expect(canBeOnAccount('shaken')).toBe(false);
    expect(canBeOnAccount('insurance')).toBe(false);
  });
});

describe('bookkeepingLine', () => {
  it('税込の金額から消費税を逆算する（切り捨て）', () => {
    const l = bookkeepingLine(base);
    expect(l).toMatchObject({ account: '修繕費', consumptionTaxYen: 1000, exemptYen: 0, businessPercent: 100, businessYen: 11000 });
  });

  it('保険料・自動車税は全額が消費税のかからない分', () => {
    expect(bookkeepingLine({ ...base, category: 'insurance', amountYen: 50000 })).toMatchObject({ account: '損害保険料', consumptionTaxYen: 0, exemptYen: 50000 });
    expect(bookkeepingLine({ ...base, category: 'car_tax', amountYen: 30500 })).toMatchObject({ account: '租税公課', consumptionTaxYen: 0, exemptYen: 30500 });
  });

  it('車検は法定費用を除いた分にだけ消費税を見る', () => {
    const l = bookkeepingLine({ ...base, category: 'shaken', amountYen: 85000, exemptYen: 30000 });
    expect(l).toMatchObject({ consumptionTaxYen: 5000, exemptYen: 30000 });
  });

  it('かけは「税込 − 入力した税抜」が消費税（1円もずれない）', () => {
    const { totalYen } = withConsumptionTax(10005, '2026-06-01');
    const l = bookkeepingLine({ ...base, amountYen: totalYen, onAccount: true, enteredAmountYen: 10005 });
    expect(l.consumptionTaxYen).toBe(1000);
    expect(l.onAccount).toBe(true);
  });

  it('給油（軽油・かけの税抜単価）：軽油引取税は消費税のかからない分、消費税は請求の計算と同じ', () => {
    const fuel = { fuelType: 'diesel' as const, liters: 50, unitPrice: 130, basis: 'tax_excluded' as const };
    const cost = calculateFuelCost({ date: '2026-06-01', fuelType: 'diesel', liters: 50, unitPriceYen: 130, basis: 'tax_excluded' });
    const l = bookkeepingLine({ ...base, category: 'fuel', amountYen: cost.totalYen, onAccount: true, fuel });
    expect(l.exemptYen).toBe(750); // 50L × 15.0円
    expect(l.consumptionTaxYen).toBe(cost.consumptionTaxYen);
    expect(l.account).toBe('車両費');
  });

  it('給油（軽油）で金額がレシートと違っても、量から軽油引取税を除いて逆算する', () => {
    const fuel = { fuelType: 'diesel' as const, liters: 50, unitPrice: 150, basis: 'tax_included' as const };
    const l = bookkeepingLine({ ...base, category: 'fuel', amountYen: 7400, fuel });
    expect(l.exemptYen).toBe(750);
    expect(l.consumptionTaxYen).toBe(Math.floor(((7400 - 750) * 10) / 110));
  });

  it('給油（軽油）で単価が無くても、量が分かれば軽油引取税を除く', () => {
    const fuel = { fuelType: 'diesel' as const, liters: 40, unitPrice: null, basis: null };
    const l = bookkeepingLine({ ...base, category: 'fuel', amountYen: 6000, fuel });
    expect(l.exemptYen).toBe(600);
  });

  it('仕事で使う割合を掛けて、経費にする額を出す（切り捨て）', () => {
    const l = bookkeepingLine({ ...base, amountYen: 3333 }, 50);
    expect(l.businessYen).toBe(1666);
    expect(l.businessConsumptionTaxYen).toBe(Math.floor(Math.floor((3333 * 10) / 110) / 2));
  });

  it('割合は 0〜100 におさめ、未設定は 100%', () => {
    expect(bookkeepingLine(base, 150).businessPercent).toBe(100);
    expect(bookkeepingLine(base, -5).businessPercent).toBe(0);
    expect(bookkeepingLine(base, null).businessPercent).toBe(100);
  });
});

describe('annualBookkeeping', () => {
  const expenses: BookkeepingExpense[] = [
    { ...base, date: '2025-12-31', amountYen: 1000 },
    { ...base, date: '2026-01-01', amountYen: 11000 },
    { ...base, date: '2026-03-10', category: 'insurance', amountYen: 40000 },
    { ...base, date: '2026-12-31', category: 'maintenance', amountYen: 5500, onAccount: true, enteredAmountYen: 5000 },
    { ...base, date: '2027-01-01', amountYen: 9999 },
  ];

  it('1月1日〜12月31日の分だけをまとめ、科目ごとに合計する', () => {
    const r = annualBookkeeping(expenses, 2026, 60);
    expect(r.lines.map((l) => l.date)).toEqual(['2026-01-01', '2026-03-10', '2026-12-31']);
    expect(r.totalYen).toBe(56500);
    expect(r.businessYen).toBe(6600 + 24000 + 3300);
    expect(r.byAccount).toEqual([
      { account: '損害保険料', amountYen: 40000, businessYen: 24000, consumptionTaxYen: 0, count: 1 },
      { account: '修繕費', amountYen: 16500, businessYen: 9900, consumptionTaxYen: 600 + 300, count: 2 },
    ]);
    expect(r.onAccountCount).toBe(1);
    expect(r.onAccountYen).toBe(5500);
  });

  it('CSV：明細と科目ごとの合計。カンマや引用符を含むメモは囲む', () => {
    const r = annualBookkeeping([{ ...base, note: 'タイヤ "4本", 工賃込み' }], 2026);
    const csv = bookkeepingCsv(r, () => '整備・修理', 'イジログ 2026年');
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('イジログ 2026年');
    expect(lines[2]).toBe('2026-06-01,修繕費,整備・修理,その場で支払い,11000,1000,0,100,11000,1000,"タイヤ ""4本"", 工賃込み"');
    expect(lines.at(-1)).toBe('合計,1,11000,11000,1000');
  });
});

describe('defaultBookkeepingYear', () => {
  it('1〜3月は前の年（申告の時期）、4月からは今年', () => {
    expect(defaultBookkeepingYear('2027-02-15')).toBe(2026);
    expect(defaultBookkeepingYear('2027-03-31')).toBe(2026);
    expect(defaultBookkeepingYear('2026-11-07')).toBe(2026);
  });
});
