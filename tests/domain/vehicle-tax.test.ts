import { describe, expect, it } from 'vitest';
import {
  applyPrefectureRate,
  automobileTaxFor,
  inspectionYears,
  fiscalYearOf,
  parseYearMonth,
  parseYearMonthDay,
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
    expect(weightTaxFor(car, '2026-06-10')).toEqual({ amountYen: 24600, heavy: false, years: 2 });
    expect(weightTaxFor({ ...car, vehicleWeightKg: 1500 }, '2026-06-10')?.amountYen).toBe(24600);
    expect(weightTaxFor({ ...car, vehicleWeightKg: 1501 }, '2026-06-10')?.amountYen).toBe(32800);
  });

  it('13年・18年を過ぎた車検から重くなる（月で判定）', () => {
    const old = { ...car, firstRegisteredOn: '2013-06-01' };
    expect(weightTaxFor(old, '2026-05-31')?.amountYen).toBe(24600);
    expect(weightTaxFor(old, '2026-06-01')).toEqual({ amountYen: 34200, heavy: true, years: 2 });
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

describe('parseYearMonthDay', () => {
  it('和暦・西暦の年月日を読む', () => {
    expect(parseYearMonthDay('令和9年6月30日')).toBe('2027-06-30');
    expect(parseYearMonthDay('R9.6.30')).toBe('2027-06-30');
    expect(parseYearMonthDay('2027/6/30')).toBe('2027-06-30');
    expect(parseYearMonthDay('2027-06-30')).toBe('2027-06-30');
    expect(parseYearMonthDay('令和9年2月30日')).toBeNull();
    expect(parseYearMonthDay('令和9年6月')).toBeNull();
  });
});

describe('用途・自家用/事業用ごとの自動車税', () => {
  const base: VehicleTaxSpec = { ...car, firstRegisteredOn: '2018-04-01' };
  it('事業用乗用（2019-10 の前後で同じ。13年超は15%重課）', () => {
    const taxi = { ...base, businessClass: 'commercial' as const, displacementCc: 1990 };
    expect(automobileTaxFor(taxi, 2026)).toEqual({ amountYen: 9500, heavy: false });
    expect(automobileTaxFor({ ...taxi, firstRegisteredOn: '2021-01-01' }, 2026)?.amountYen).toBe(9500);
    expect(automobileTaxFor({ ...taxi, firstRegisteredOn: '2010-01-01' }, 2026)).toEqual({ amountYen: 10900, heavy: true });
  });
  it('貨物（乗車定員3人以下）は最大積載量で決まり、8t 超は 1t ごとに加算。重課は10%', () => {
    const truck = { ...base, usage: 'cargo' as const, seatingCapacity: 3, maxLoadKg: 2000, displacementCc: 2980, powertrain: 'diesel' as const };
    expect(automobileTaxFor(truck, 2026)?.amountYen).toBe(11500);
    expect(automobileTaxFor({ ...truck, maxLoadKg: 2001 }, 2026)?.amountYen).toBe(16000);
    expect(automobileTaxFor({ ...truck, maxLoadKg: 9500 }, 2026)?.amountYen).toBe(40500 + 6300 * 2);
    expect(automobileTaxFor({ ...truck, businessClass: 'commercial' }, 2026)?.amountYen).toBe(9000);
    // ディーゼルは11年超で重課
    expect(automobileTaxFor({ ...truck, firstRegisteredOn: '2014-06-01' }, 2026)).toEqual({ amountYen: 12600, heavy: true });
  });
  it('貨客兼用車（乗車定員4人以上の貨物）は貨物の額＋排気量ごとの額', () => {
    const van = { ...base, usage: 'cargo' as const, seatingCapacity: 5, maxLoadKg: 400, displacementCc: 1496 };
    expect(automobileTaxFor(van, 2026)?.amountYen).toBe(8000 + 6300);
    expect(automobileTaxFor({ ...van, displacementCc: 996 }, 2026)?.amountYen).toBe(13200);
    expect(automobileTaxFor({ ...van, displacementCc: 1798, businessClass: 'commercial' }, 2026)?.amountYen).toBe(12800);
    // 重課の額は確かめられていないので出さない
    expect(automobileTaxFor({ ...van, firstRegisteredOn: '2010-01-01' }, 2026)).toBeNull();
  });
  it('自家用バス（定員ごと）。事業用・51人以上・特種は出さない', () => {
    const bus = { ...base, usage: 'bus' as const, seatingCapacity: 29, displacementCc: 4000, powertrain: 'diesel' as const };
    expect(automobileTaxFor(bus, 2026)?.amountYen).toBe(33000);
    expect(automobileTaxFor({ ...bus, firstRegisteredOn: '2012-01-01' }, 2026)).toEqual({ amountYen: 36300, heavy: true });
    expect(automobileTaxFor({ ...bus, businessClass: 'commercial' }, 2026)).toBeNull();
    expect(automobileTaxFor({ ...bus, seatingCapacity: 55 }, 2026)).toBeNull();
    expect(automobileTaxFor({ ...base, usage: 'special' }, 2026)).toBeNull();
  });
  it('軽：事業用乗用・自家用貨物・事業用貨物', () => {
    const kei: VehicleTaxSpec = { vehicleClass: 'kei', displacementCc: 658, firstRegisteredOn: '2018-05-01', powertrain: 'gasoline', vehicleWeightKg: null };
    expect(automobileTaxFor({ ...kei, businessClass: 'commercial' }, 2026)?.amountYen).toBe(6900);
    expect(automobileTaxFor({ ...kei, usage: 'cargo' }, 2026)?.amountYen).toBe(5000);
    expect(automobileTaxFor({ ...kei, usage: 'cargo', firstRegisteredOn: '2015-03-01' }, 2026)?.amountYen).toBe(4000);
    expect(automobileTaxFor({ ...kei, usage: 'cargo', businessClass: 'commercial' }, 2026)?.amountYen).toBe(3800);
    expect(automobileTaxFor({ ...kei, usage: 'cargo', firstRegisteredOn: '2010-01-01' }, 2026)?.amountYen).toBe(6000);
  });
  it('都道府県の倍率（表に無い県は標準税率のまま）', () => {
    expect(applyPrefectureRate(30500, '東京都')).toBe(30500);
    expect(applyPrefectureRate(30500, '東京都', { 東京都: 1.05 })).toBe(32000);
    expect(applyPrefectureRate(30500, null, { 東京都: 1.05 })).toBe(30500);
  });
});

describe('用途・自家用/事業用ごとの重量税', () => {
  const base: VehicleTaxSpec = { ...car, firstRegisteredOn: '2018-04-01' };
  it('車検の有効期間：自家用乗用・軽は2年、事業用乗用・貨物は1年', () => {
    expect(inspectionYears(base)).toBe(2);
    expect(inspectionYears({ ...base, businessClass: 'commercial' })).toBe(1);
    expect(inspectionYears({ ...base, usage: 'cargo' })).toBe(1);
    expect(inspectionYears({ ...base, vehicleClass: 'kei', usage: 'cargo' })).toBe(2);
  });
  it('事業用乗用：0.5t ごと 2,600円 × 1年', () => {
    expect(weightTaxFor({ ...base, businessClass: 'commercial', vehicleWeightKg: 1500 }, '2026-06-01')).toEqual({ amountYen: 7800, heavy: false, years: 1 });
  });
  it('自家用貨物：車両総重量 1t ごと。2.5t 以下と 2.5t 超で単価が違う', () => {
    const truck = { ...base, usage: 'cargo' as const, grossWeightKg: 2400 };
    expect(weightTaxFor(truck, '2026-06-01')?.amountYen).toBe(9900);
    expect(weightTaxFor({ ...truck, grossWeightKg: 2900 }, '2026-06-01')?.amountYen).toBe(12300);
    expect(weightTaxFor({ ...truck, grossWeightKg: 2900, firstRegisteredOn: '2012-01-01' }, '2026-06-01')?.amountYen).toBe(17100);
    expect(weightTaxFor({ ...truck, businessClass: 'commercial', grossWeightKg: 4000 }, '2026-06-01')?.amountYen).toBe(10400);
    expect(weightTaxFor({ ...truck, grossWeightKg: null }, '2026-06-01')).toBeNull();
  });
  it('事業用の軽は1台 2,600円 × 2年。事業用・貨物の電気自動車、バスは出さない', () => {
    const kei: VehicleTaxSpec = { vehicleClass: 'kei', displacementCc: 658, firstRegisteredOn: '2018-05-01', powertrain: 'gasoline', vehicleWeightKg: null, businessClass: 'commercial', usage: 'cargo' };
    expect(weightTaxFor(kei, '2026-06-01')?.amountYen).toBe(5200);
    expect(weightTaxFor({ ...kei, powertrain: 'electric' }, '2026-06-01')).toBeNull();
    expect(weightTaxFor({ ...base, usage: 'bus' }, '2026-06-01')).toBeNull();
  });
});
