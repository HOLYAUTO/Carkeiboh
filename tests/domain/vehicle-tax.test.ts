import { describe, expect, it } from 'vitest';
import {
  automobileTaxFor,
  fiscalYearOf,
  parseYearMonth,
  vehicleTaxSpecLabel,
  weightTaxFor,
  type VehicleTaxSpec,
} from '../../supabase/functions/_shared/domain/vehicle-tax.ts';

const car: VehicleTaxSpec = {
  vehicleClass: 'standard',
  displacementCc: 1496,
  firstRegisteredOn: '2020-06-01',
  powertrain: 'gasoline',
  vehicleWeightKg: 1180,
};

describe('fiscalYearOf', () => {
  it('4月から翌年3月までが1つの年度', () => {
    expect(fiscalYearOf('2026-04-01')).toBe(2026);
    expect(fiscalYearOf('2027-03-31')).toBe(2026);
    expect(fiscalYearOf('2026-03-31')).toBe(2025);
  });
});

describe('automobileTaxFor（自動車税）', () => {
  it('2019-10-01 以後の登録は新しい税額、それより前は前の税額', () => {
    expect(automobileTaxFor(car, 2026)).toEqual({ amountYen: 30500, heavy: false });
    expect(automobileTaxFor({ ...car, firstRegisteredOn: '2019-10-01' }, 2026)?.amountYen).toBe(30500);
    expect(automobileTaxFor({ ...car, firstRegisteredOn: '2019-09-01' }, 2026)?.amountYen).toBe(34500);
  });

  it('排気量の区分の境目（1,500cc までは 1.5L 以下）', () => {
    expect(automobileTaxFor({ ...car, displacementCc: 1000 }, 2026)?.amountYen).toBe(25000);
    expect(automobileTaxFor({ ...car, displacementCc: 1500 }, 2026)?.amountYen).toBe(30500);
    expect(automobileTaxFor({ ...car, displacementCc: 1501 }, 2026)?.amountYen).toBe(36000);
    expect(automobileTaxFor({ ...car, displacementCc: 6600 }, 2026)?.amountYen).toBe(110000);
  });

  it('ガソリンは13年を過ぎてから最初の4月1日の年度から重課', () => {
    const old = { ...car, displacementCc: 1990, firstRegisteredOn: '2012-06-01' };
    expect(automobileTaxFor(old, 2025)).toEqual({ amountYen: 39500, heavy: false });
    expect(automobileTaxFor(old, 2026)).toEqual({ amountYen: 45400, heavy: true });
    // 2013年3月登録は 2026年3月に13年 → 2026年度から。2013年4月登録は 2027年度から
    expect(automobileTaxFor({ ...old, firstRegisteredOn: '2013-03-01' }, 2026)?.heavy).toBe(true);
    expect(automobileTaxFor({ ...old, firstRegisteredOn: '2013-04-01' }, 2026)?.heavy).toBe(false);
    expect(automobileTaxFor({ ...old, firstRegisteredOn: '2013-04-01' }, 2027)?.heavy).toBe(true);
  });

  it('ディーゼルは11年で重課、ハイブリッド・電気は重課なし', () => {
    const diesel = { ...car, displacementCc: 2200, powertrain: 'diesel' as const, firstRegisteredOn: '2015-02-01' };
    expect(automobileTaxFor(diesel, 2026)).toEqual({ amountYen: 51700, heavy: true });
    expect(automobileTaxFor({ ...diesel, powertrain: 'hybrid' }, 2026)).toEqual({ amountYen: 45000, heavy: false });
  });

  it('電気自動車は 1,000cc 以下の税額（排気量はいらない）', () => {
    expect(automobileTaxFor({ ...car, powertrain: 'electric', displacementCc: null }, 2026)?.amountYen).toBe(25000);
  });

  it('軽自動車：2015-04 以後 10,800円、それより前 7,200円、13年超 12,900円', () => {
    const kei: VehicleTaxSpec = { vehicleClass: 'kei', displacementCc: null, firstRegisteredOn: '2018-05-01', powertrain: 'gasoline', vehicleWeightKg: null };
    expect(automobileTaxFor(kei, 2026)?.amountYen).toBe(10800);
    expect(automobileTaxFor({ ...kei, firstRegisteredOn: '2015-03-01' }, 2026)?.amountYen).toBe(7200);
    expect(automobileTaxFor({ ...kei, firstRegisteredOn: '2012-01-01' }, 2026)).toEqual({ amountYen: 12900, heavy: true });
  });

  it('車検証の項目が足りなければ計算しない', () => {
    expect(automobileTaxFor({ ...car, displacementCc: null }, 2026)).toBeNull();
    expect(automobileTaxFor({ ...car, firstRegisteredOn: null }, 2026)).toBeNull();
    expect(automobileTaxFor({ ...car, vehicleClass: null }, 2026)).toBeNull();
  });
});

describe('weightTaxFor（車検の重量税・2年）', () => {
  it('0.5t ごとに 8,200円（1,180kg → 1.5t 以下）', () => {
    expect(weightTaxFor(car, '2026-06-10')).toEqual({ amountYen: 24600, heavy: false });
    expect(weightTaxFor({ ...car, vehicleWeightKg: 1500 }, '2026-06-10')?.amountYen).toBe(24600);
    expect(weightTaxFor({ ...car, vehicleWeightKg: 1501 }, '2026-06-10')?.amountYen).toBe(32800);
  });

  it('13年・18年を過ぎた車検から重くなる（月で判定）', () => {
    const old = { ...car, firstRegisteredOn: '2013-06-01' };
    expect(weightTaxFor(old, '2026-05-31')?.amountYen).toBe(24600);
    expect(weightTaxFor(old, '2026-06-01')).toEqual({ amountYen: 34200, heavy: true });
    expect(weightTaxFor({ ...car, firstRegisteredOn: '2008-06-01' }, '2026-06-01')?.amountYen).toBe(37800);
  });

  it('ハイブリッドは経年の重課なし、電気は本則税率', () => {
    const old = { ...car, firstRegisteredOn: '2008-06-01' };
    expect(weightTaxFor({ ...old, powertrain: 'hybrid' }, '2026-06-01')?.amountYen).toBe(24600);
    expect(weightTaxFor({ ...car, powertrain: 'electric', vehicleWeightKg: 1800 }, '2026-06-01')?.amountYen).toBe(20000);
  });

  it('軽自動車は1台あたり（6,600円・13年 8,200円・18年 8,800円）', () => {
    const kei: VehicleTaxSpec = { vehicleClass: 'kei', displacementCc: null, firstRegisteredOn: '2016-01-01', powertrain: 'gasoline', vehicleWeightKg: null };
    expect(weightTaxFor(kei, '2026-06-01')?.amountYen).toBe(6600);
    expect(weightTaxFor({ ...kei, firstRegisteredOn: '2012-01-01' }, '2026-06-01')?.amountYen).toBe(8200);
    expect(weightTaxFor({ ...kei, firstRegisteredOn: '2007-01-01' }, '2026-06-01')?.amountYen).toBe(8800);
  });

  it('普通車で車両重量がなければ計算しない', () => {
    expect(weightTaxFor({ ...car, vehicleWeightKg: null }, '2026-06-01')).toBeNull();
  });
});

describe('vehicleTaxSpecLabel', () => {
  it('計算に使った車検証の項目を短く書く', () => {
    expect(vehicleTaxSpecLabel(car)).toBe('1,496cc・2020年6月登録・ガソリン');
    expect(vehicleTaxSpecLabel(car, true)).toBe('1,496cc・1,180kg・2020年6月登録・ガソリン');
  });
});

describe('parseYearMonth（初度登録年月）', () => {
  it('車検証の和暦のまま読める', () => {
    expect(parseYearMonth('令和2年6月')).toBe('2020-06-01');
    expect(parseYearMonth('令和元年10月')).toBe('2019-10-01');
    expect(parseYearMonth('R2.6')).toBe('2020-06-01');
    expect(parseYearMonth('h27/10')).toBe('2015-10-01');
    expect(parseYearMonth('平成３１年４月')).toBe('2019-04-01');
  });
  it('西暦も読める', () => {
    expect(parseYearMonth('2020/6')).toBe('2020-06-01');
    expect(parseYearMonth('2020-06')).toBe('2020-06-01');
    expect(parseYearMonth('2020年6月')).toBe('2020-06-01');
  });
  it('読めないものは null', () => {
    expect(parseYearMonth('')).toBeNull();
    expect(parseYearMonth('2020/13')).toBeNull();
    expect(parseYearMonth('20/6')).toBeNull();
    expect(parseYearMonth('令和2年')).toBeNull();
  });
});
