/**
 * 給油：税の内訳（かけ売りのとき給油量と単価から合計を出す）と、満タン法の燃費。
 * 税率は日付ごとの表で持ち、給油した日の税率で計算する（暫定税率の廃止などで変わるため）。
 */
import type { IsoDate } from './dates.ts';
import { effectiveOdo, type MeterReplacement } from './odo.ts';

export const FUEL_TYPES = ['regular', 'premium', 'diesel'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  regular: 'レギュラー',
  premium: 'ハイオク',
  diesel: '軽油',
};

/**
 * 単価に含まれる税。
 * - tax_included：店頭の表示価格（揮発油税・石油石炭税・軽油引取税・消費税をすべて含む）
 * - tax_excluded：かけ売りの請求書の単価（消費税を含まない。軽油は軽油引取税も含まない）
 */
export const FUEL_PRICE_BASES = ['tax_included', 'tax_excluded'] as const;
export type FuelPriceBasis = (typeof FUEL_PRICE_BASES)[number];

export function isFuelType(value: unknown): value is FuelType {
  return typeof value === 'string' && (FUEL_TYPES as readonly string[]).includes(value);
}

/** 1Lあたりの税額（0.01円単位の整数）と消費税率（%） */
export interface FuelTaxRates {
  /** 揮発油税（ガソリン） */
  gasolineTax: number;
  /** 地方揮発油税（ガソリン） */
  localGasolineTax: number;
  /** 石油石炭税（地球温暖化対策のための税を含む。ガソリン・軽油とも） */
  petroleumCoalTax: number;
  /** 軽油引取税（軽油。消費税の対象外） */
  dieselDeliveryTax: number;
  consumptionTaxPercent: number;
}

/**
 * 税率の履歴（その日から適用）。いちばん古い行より前の日付には、いちばん古い行を使う。
 * - 2025-12-31 ガソリンの暫定税率を廃止（揮発油税 48.6→24.3円、地方揮発油税 5.2→4.4円）
 * - 2026-04-01 軽油引取税の暫定税率を廃止（32.1→15.0円）
 * 税率が変わったら、この表に行を足す（docs/open-questions.md の 53）
 */
export const FUEL_TAX_HISTORY: readonly { from: IsoDate; rates: FuelTaxRates }[] = [
  { from: '2014-04-01', rates: { gasolineTax: 4860, localGasolineTax: 520, petroleumCoalTax: 254, dieselDeliveryTax: 3210, consumptionTaxPercent: 8 } },
  { from: '2016-04-01', rates: { gasolineTax: 4860, localGasolineTax: 520, petroleumCoalTax: 280, dieselDeliveryTax: 3210, consumptionTaxPercent: 8 } },
  { from: '2019-10-01', rates: { gasolineTax: 4860, localGasolineTax: 520, petroleumCoalTax: 280, dieselDeliveryTax: 3210, consumptionTaxPercent: 10 } },
  { from: '2025-12-31', rates: { gasolineTax: 2430, localGasolineTax: 440, petroleumCoalTax: 280, dieselDeliveryTax: 3210, consumptionTaxPercent: 10 } },
  { from: '2026-04-01', rates: { gasolineTax: 2430, localGasolineTax: 440, petroleumCoalTax: 280, dieselDeliveryTax: 1500, consumptionTaxPercent: 10 } },
];

export function fuelTaxRatesOn(date: IsoDate): FuelTaxRates {
  return (FUEL_TAX_HISTORY.filter((r) => r.from <= date).at(-1) ?? FUEL_TAX_HISTORY[0]).rates;
}

/** 給油量の上限（L）と単価の上限（円/L）。DB の check と同じ */
export const MAX_FUEL_LITERS = 1000;
export const MAX_FUEL_UNIT_PRICE = 9999.9;

/** 給油量は 0.01L、単価は 0.1円まで */
export function isValidFuelLiters(liters: number): boolean {
  return Number.isFinite(liters) && liters > 0 && liters <= MAX_FUEL_LITERS && Math.abs(liters * 100 - Math.round(liters * 100)) < 1e-6;
}

export function isValidFuelUnitPrice(price: number): boolean {
  return Number.isFinite(price) && price > 0 && price <= MAX_FUEL_UNIT_PRICE && Math.abs(price * 10 - Math.round(price * 10)) < 1e-6;
}

export interface FuelCostInput {
  date: IsoDate;
  fuelType: FuelType;
  liters: number;
  unitPriceYen: number;
  basis: FuelPriceBasis;
}

export interface FuelCost {
  /** 支払う合計（税込・円） */
  totalYen: number;
  /** 本体価格（税をすべて除いた分） */
  baseYen: number;
  gasolineTaxYen: number;
  localGasolineTaxYen: number;
  petroleumCoalTaxYen: number;
  dieselDeliveryTaxYen: number;
  consumptionTaxYen: number;
  consumptionTaxPercent: number;
}

/**
 * 給油量と単価から、合計と税の内訳を出す。端数はすべて切り捨て（docs/open-questions.md の 53）。
 * 浮動小数の誤差を避けるため、給油量は 0.01L、単価は 0.1円、税率は 0.01円の整数にして計算する。
 */
export function calculateFuelCost(input: FuelCostInput): FuelCost {
  const rates = fuelTaxRatesOn(input.date);
  const cl = Math.round(input.liters * 100);
  const price = Math.round(input.unitPriceYen * 10);
  const perLiter = (rate: number) => Math.floor((cl * rate) / 10_000);
  const pct = rates.consumptionTaxPercent;
  const isDiesel = input.fuelType === 'diesel';

  const product = Math.floor((cl * price) / 1000);
  const gasolineTaxYen = isDiesel ? 0 : perLiter(rates.gasolineTax);
  const localGasolineTaxYen = isDiesel ? 0 : perLiter(rates.localGasolineTax);
  const petroleumCoalTaxYen = perLiter(rates.petroleumCoalTax);
  const dieselDeliveryTaxYen = isDiesel ? perLiter(rates.dieselDeliveryTax) : 0;

  let totalYen: number;
  let consumptionTaxYen: number;
  if (input.basis === 'tax_included') {
    // 店頭価格 = (本体 + 揮発油税 + 石油石炭税) × (1 + 消費税率) + 軽油引取税
    totalYen = product;
    consumptionTaxYen = Math.floor(((totalYen - dieselDeliveryTaxYen) * pct) / (100 + pct));
  } else {
    // 請求書の単価には消費税（軽油は軽油引取税も）が入っていない
    consumptionTaxYen = Math.floor((product * pct) / 100);
    totalYen = product + consumptionTaxYen + dieselDeliveryTaxYen;
  }
  const baseYen = totalYen - consumptionTaxYen - gasolineTaxYen - localGasolineTaxYen - petroleumCoalTaxYen - dieselDeliveryTaxYen;
  return {
    totalYen,
    baseYen,
    gasolineTaxYen,
    localGasolineTaxYen,
    petroleumCoalTaxYen,
    dieselDeliveryTaxYen,
    consumptionTaxYen,
    consumptionTaxPercent: pct,
  };
}

// ---------------------------------------------------------------------------
// 燃費（満タン法）
// ---------------------------------------------------------------------------

export interface FuelFill {
  /** 区間の終わりの給油を見分けるため（任意） */
  id?: string;
  date: IsoDate;
  /** 給油したときのメーターの値（km）。満タンの給油に無いと、その区間の燃費は出せない */
  odoKm: number | null;
  /** 給油量が分からない給油を挟むと、その区間の燃費は出せない */
  liters: number | null;
  fullTank: boolean;
  amountYen: number;
}

export interface FuelEconomySegment {
  /** 区間の始まり（満タンにした日）と終わり（次に満タンにした日） */
  from: IsoDate;
  to: IsoDate;
  /** 区間の終わりの給油の id（渡したときだけ） */
  toId?: string;
  distanceKm: number;
  liters: number;
  kmPerLiter: number;
}

/**
 * 満タンから次の満タンまでを1区間とし、走った距離 ÷ その間に入れた量で燃費を出す。
 * 満タンでない給油は量だけ足す。給油量が分からない給油や、走行距離のない満タンの給油を挟んだら区間を切る。
 * fills は日付の古い順（同じ日は記録した順）に並べて渡す。
 */
export function fuelEconomySegments(fills: FuelFill[], replacements: MeterReplacement[] = []): FuelEconomySegment[] {
  const ordered = fills
    .map((f, i) => ({ ...f, i, odo: f.odoKm == null ? null : effectiveOdo({ date: f.date, odoKm: f.odoKm }, replacements) }))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.odo != null && b.odo != null && a.odo !== b.odo ? a.odo - b.odo : a.i - b.i));

  const segments: FuelEconomySegment[] = [];
  let start: { date: IsoDate; odo: number } | null = null;
  let liters = 0;
  for (const f of ordered) {
    if (f.liters == null) {
      start = null;
      continue;
    }
    if (start) liters += f.liters;
    if (!f.fullTank) continue;
    if (f.odo == null) {
      start = null;
      continue;
    }
    if (start && f.odo > start.odo && liters > 0) {
      const distanceKm = f.odo - start.odo;
      segments.push({ from: start.date, to: f.date, toId: f.id, distanceKm, liters: round2(liters), kmPerLiter: distanceKm / liters });
    }
    start = { date: f.date, odo: f.odo };
    liters = 0;
  }
  return segments;
}

export interface FuelSummary {
  /** 期間の給油の回数・量・金額 */
  count: number;
  liters: number;
  amountYen: number;
  /** 期間の給油の、1Lあたりの平均（税込）。量の分かる給油だけで出す */
  averageUnitPriceYen: number | null;
  /** 期間内に終わった区間の平均燃費（km/L）。区間の距離の合計 ÷ 量の合計 */
  averageKmPerLiter: number | null;
  /** いちばん新しい区間（期間に関係なく） */
  latest: FuelEconomySegment | null;
  /** 期間の燃費の計算に使った距離 */
  distanceKm: number;
}

export function summarizeFuel(fills: FuelFill[], from: IsoDate, to: IsoDate, replacements: MeterReplacement[] = []): FuelSummary {
  const inRange = fills.filter((f) => f.date >= from && f.date <= to);
  const withLiters = inRange.filter((f) => f.liters != null);
  const litersKnown = withLiters.reduce((s, f) => s + f.liters!, 0);
  const amountForKnown = withLiters.reduce((s, f) => s + f.amountYen, 0);
  const segments = fuelEconomySegments(fills, replacements);
  const periodSegments = segments.filter((s) => s.to >= from && s.to <= to);
  const segDistance = periodSegments.reduce((s, x) => s + x.distanceKm, 0);
  const segLiters = periodSegments.reduce((s, x) => s + x.liters, 0);
  return {
    count: inRange.length,
    liters: round2(litersKnown),
    amountYen: inRange.reduce((s, f) => s + f.amountYen, 0),
    averageUnitPriceYen: litersKnown > 0 ? Math.round((amountForKnown / litersKnown) * 10) / 10 : null,
    averageKmPerLiter: segLiters > 0 ? segDistance / segLiters : null,
    latest: segments.at(-1) ?? null,
    distanceKm: segDistance,
  };
}

/** 燃費を「12.3km/L」のように小数1桁で書く */
export function formatKmPerLiter(kmPerLiter: number): string {
  return `${(Math.round(kmPerLiter * 10) / 10).toFixed(1)}km/L`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
