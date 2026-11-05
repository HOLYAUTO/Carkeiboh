import { describe, expect, it } from 'vitest';
import {
  calculateFuelCost,
  formatKmPerLiter,
  fuelEconomySegments,
  fuelTaxRatesOn,
  isValidFuelLiters,
  isValidFuelUnitPrice,
  summarizeFuel,
  type FuelFill,
} from '../../supabase/functions/_shared/domain/fuel.ts';

describe('fuelTaxRatesOn', () => {
  it('ガソリンの暫定税率は 2025-12-31 から無くなる', () => {
    expect(fuelTaxRatesOn('2025-12-30').gasolineTax).toBe(4860);
    expect(fuelTaxRatesOn('2025-12-31').gasolineTax).toBe(2430);
    expect(fuelTaxRatesOn('2025-12-31').localGasolineTax).toBe(440);
  });
  it('軽油引取税の暫定税率は 2026-04-01 から無くなる', () => {
    expect(fuelTaxRatesOn('2026-03-31').dieselDeliveryTax).toBe(3210);
    expect(fuelTaxRatesOn('2026-04-01').dieselDeliveryTax).toBe(1500);
  });
  it('表より前の日付は、いちばん古い税率を使う', () => {
    expect(fuelTaxRatesOn('2010-01-01').consumptionTaxPercent).toBe(8);
  });
});

describe('calculateFuelCost', () => {
  it('ガソリン・店頭価格（税込）：合計は量×単価、内訳を税ごとに分ける', () => {
    const c = calculateFuelCost({ date: '2026-11-05', fuelType: 'regular', liters: 40, unitPriceYen: 160, basis: 'tax_included' });
    expect(c).toEqual({
      totalYen: 6400,
      consumptionTaxYen: 581, // 6400 × 10/110 の切り捨て
      gasolineTaxYen: 972, // 40L × 24.3円
      localGasolineTaxYen: 176, // 40L × 4.4円
      petroleumCoalTaxYen: 112, // 40L × 2.8円
      dieselDeliveryTaxYen: 0,
      baseYen: 4559,
      consumptionTaxPercent: 10,
    });
  });

  it('ガソリン・かけ売りの請求単価（消費税抜き）：消費税を足す', () => {
    const c = calculateFuelCost({ date: '2026-11-05', fuelType: 'premium', liters: 35.5, unitPriceYen: 158.4, basis: 'tax_excluded' });
    // 35.5 × 158.4 = 5623.2 → 5623、消費税 562
    expect(c.totalYen).toBe(5623 + 562);
    expect(c.consumptionTaxYen).toBe(562);
    expect(c.baseYen + c.gasolineTaxYen + c.localGasolineTaxYen + c.petroleumCoalTaxYen + c.consumptionTaxYen).toBe(c.totalYen);
  });

  it('軽油・請求単価：軽油引取税は消費税の対象にせず、別に足す', () => {
    const c = calculateFuelCost({ date: '2026-11-05', fuelType: 'diesel', liters: 50, unitPriceYen: 120, basis: 'tax_excluded' });
    expect(c.dieselDeliveryTaxYen).toBe(750);
    expect(c.consumptionTaxYen).toBe(600);
    expect(c.totalYen).toBe(6000 + 750 + 600);
    expect(c.gasolineTaxYen).toBe(0);
  });

  it('軽油・店頭価格：消費税は軽油引取税を除いた分から出す', () => {
    const c = calculateFuelCost({ date: '2026-11-05', fuelType: 'diesel', liters: 50, unitPriceYen: 147, basis: 'tax_included' });
    expect(c.totalYen).toBe(7350);
    expect(c.consumptionTaxYen).toBe(Math.floor(((7350 - 750) * 10) / 110));
  });

  it('暫定税率があった日の給油は、当時の税率で分ける', () => {
    const c = calculateFuelCost({ date: '2025-06-01', fuelType: 'regular', liters: 10, unitPriceYen: 175, basis: 'tax_included' });
    expect(c.gasolineTaxYen).toBe(486);
    expect(c.localGasolineTaxYen).toBe(52);
  });

  it('小数の量・単価でも浮動小数の誤差で1円ずれない', () => {
    // 0.1 × 3 のような誤差が出る組み合わせ
    const c = calculateFuelCost({ date: '2026-11-05', fuelType: 'regular', liters: 30.03, unitPriceYen: 170.1, basis: 'tax_included' });
    expect(c.totalYen).toBe(Math.floor((3003 * 1701) / 1000));
  });
});

describe('入力の検査', () => {
  it('給油量は 0.01L まで、単価は 0.1円まで', () => {
    expect(isValidFuelLiters(32.15)).toBe(true);
    expect(isValidFuelLiters(32.155)).toBe(false);
    expect(isValidFuelLiters(0)).toBe(false);
    expect(isValidFuelLiters(1001)).toBe(false);
    expect(isValidFuelUnitPrice(172.5)).toBe(true);
    expect(isValidFuelUnitPrice(172.55)).toBe(false);
  });
});

const fill = (date: string, odoKm: number | null, liters: number | null, fullTank = true, amountYen = 5000): FuelFill => ({
  date,
  odoKm,
  liters,
  fullTank,
  amountYen,
});

describe('fuelEconomySegments（満タン法）', () => {
  it('満タンから次の満タンまでの距離 ÷ 量', () => {
    const s = fuelEconomySegments([fill('2026-10-01', 40000, 30), fill('2026-10-15', 40450, 30)]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ from: '2026-10-01', to: '2026-10-15', distanceKm: 450, liters: 30, kmPerLiter: 15 });
  });

  it('途中の継ぎ足し（満タンでない給油）は量だけ足す', () => {
    const s = fuelEconomySegments([fill('2026-10-01', 40000, 30), fill('2026-10-08', null, 10, false), fill('2026-10-15', 40600, 20)]);
    expect(s[0].liters).toBe(30);
    expect(s[0].kmPerLiter).toBe(20);
  });

  it('最初の満タンより前の給油は数えない', () => {
    const s = fuelEconomySegments([fill('2026-09-20', 39800, 15, false), fill('2026-10-01', 40000, 30), fill('2026-10-15', 40450, 30)]);
    expect(s).toHaveLength(1);
    expect(s[0].liters).toBe(30);
  });

  it('量の分からない給油を挟んだら、その区間は出さない', () => {
    const s = fuelEconomySegments([fill('2026-10-01', 40000, 30), fill('2026-10-08', null, null, false), fill('2026-10-15', 40450, 30), fill('2026-10-30', 40900, 30)]);
    expect(s.map((x) => x.from)).toEqual(['2026-10-15']);
  });

  it('走行距離のない満タンは区間を切る', () => {
    const s = fuelEconomySegments([fill('2026-10-01', 40000, 30), fill('2026-10-15', null, 30), fill('2026-10-30', 40900, 30)]);
    expect(s).toEqual([]);
  });

  it('並び順が逆でも日付順に計算する。メーター交換は実走行距離に揃える', () => {
    const s = fuelEconomySegments(
      [fill('2026-10-15', 100, 25), fill('2026-10-01', 40000, 30)],
      [{ replacedOn: '2026-10-10', odoBeforeKm: 40200, odoAfterKm: 0 }],
    );
    // 交換後の 100km は実走行 40,300km
    expect(s[0].distanceKm).toBe(300);
    expect(s[0].kmPerLiter).toBe(12);
  });
});

describe('summarizeFuel', () => {
  const fills = [
    fill('2026-09-01', 39500, 30, true, 5100),
    fill('2026-10-01', 40000, 25, true, 4250),
    fill('2026-10-15', 40450, 30, true, 5000),
    fill('2026-10-20', null, null, false, 2000),
  ];

  it('期間の量・金額・平均単価と、期間内に終わった区間の燃費', () => {
    const s = summarizeFuel(fills, '2026-10-01', '2026-10-31');
    expect(s.count).toBe(3);
    expect(s.liters).toBe(55);
    expect(s.amountYen).toBe(11250);
    // 量の分かる給油だけで割る：(4250 + 5000) / 55
    expect(s.averageUnitPriceYen).toBe(168.2);
    // 9/1→10/1（500km・25L）と 10/1→10/15（450km・30L）
    expect(s.averageKmPerLiter).toBeCloseTo(950 / 55);
    expect(s.latest?.to).toBe('2026-10-15');
  });

  it('区間がなければ燃費は null', () => {
    const s = summarizeFuel([fill('2026-10-01', 40000, 25)], '2026-10-01', '2026-10-31');
    expect(s.averageKmPerLiter).toBeNull();
    expect(s.latest).toBeNull();
  });

  it('燃費は小数1桁で書く', () => {
    expect(formatKmPerLiter(17.2727)).toBe('17.3km/L');
    expect(formatKmPerLiter(15)).toBe('15.0km/L');
  });
});
