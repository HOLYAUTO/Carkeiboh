/**
 * 自動車税（軽自動車税）と、車検のときの自動車重量税の自動計算。
 * 車検証の項目（種別・用途・自家用/事業用・総排気量・初度登録年月・燃料・乗車定員・最大積載量・車両重量・車両総重量）を
 * 一度入れてもらえば、毎回の計算はアプリで行う。
 *
 * 税額は 2026-11 時点の標準税率（docs/open-questions.md の 66・67・70）。
 * - 自動車税：自家用乗用は 2019-10-01 以後に初度登録した車と、それより前の車で税額が違う。
 *   13年超（ディーゼルは11年超）は、乗用が約15%、貨物・バスが約10%の重課（100円未満切り捨て）
 *   （2026-04-01 に名称が「自動車税種別割」から「自動車税」に変わったが、税額は変わらない）
 * - 重量税：継続検査の「当分の間税率」（エコカーは本則税率）。13年・18年経過で重くなる
 * 対応していない区分（特種用途車、事業用のバス、51人以上のバス、重課のかかる貨客兼用車、事業用・貨物の電気自動車の重量税など）は null を返す。
 * エコカー減税（重量税の免税・減免）、グリーン化特例（翌年度の軽課）、新車登録の年の月割は入れていない。
 * 税率が変わったら、下の表を直す。
 */
import { addMonths, type IsoDate } from './dates.ts';
import type { BusinessClass, Prefecture, VehicleUsage } from './vehicle-certificate.ts';

export const VEHICLE_CLASSES = ['standard', 'kei'] as const;
/** standard：普通車・小型車（登録車） / kei：軽自動車 */
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const POWERTRAINS = ['gasoline', 'diesel', 'hybrid', 'electric'] as const;
/** electric は電気自動車・燃料電池車。プラグインハイブリッドは hybrid */
export type Powertrain = (typeof POWERTRAINS)[number];

export const VEHICLE_CLASS_LABELS: Record<VehicleClass, string> = { standard: '普通車・小型車', kei: '軽自動車' };
export const POWERTRAIN_LABELS: Record<Powertrain, string> = {
  gasoline: 'ガソリン',
  diesel: 'ディーゼル',
  hybrid: 'ハイブリッド',
  electric: '電気',
};

export interface VehicleTaxSpec {
  vehicleClass: VehicleClass | null;
  /** 総排気量（cc）。普通車・小型車のガソリン・ディーゼル・ハイブリッドで使う */
  displacementCc: number | null;
  /** 初度登録年月（軽自動車は初度検査年月）。'YYYY-MM-01' */
  firstRegisteredOn: IsoDate | null;
  powertrain: Powertrain | null;
  /** 車両重量（kg）。乗用車の重量税で使う（軽自動車は使わない） */
  vehicleWeightKg: number | null;
  /** 用途。未設定は乗用として計算する */
  usage?: VehicleUsage | null;
  /** 自家用・事業用。未設定は自家用として計算する */
  businessClass?: BusinessClass | null;
  /** 乗車定員。貨物車（4人以上は貨客兼用）とバスで使う */
  seatingCapacity?: number | null;
  /** 最大積載量（kg）。貨物車の自動車税で使う */
  maxLoadKg?: number | null;
  /** 車両総重量（kg）。貨物車の重量税で使う */
  grossWeightKg?: number | null;
  /** 使用の本拠の位置の都道府県（県ごとの税率に使う） */
  prefecture?: Prefecture | null;
}

/** 4月から翌年3月までの年度（自動車税は毎年4月1日の持ち主にかかる） */
export function fiscalYearOf(date: IsoDate): number {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? year : year - 1;
}

/** 排気量の上限（cc）ごとの年税額。上限を超える最後の行は Infinity */
const PASSENGER_TAX: readonly { maxCc: number; since2019Oct: number; before: number; heavy: number; commercial: number; commercialHeavy: number }[] = [
  { maxCc: 1000, since2019Oct: 25000, before: 29500, heavy: 33900, commercial: 7500, commercialHeavy: 8600 },
  { maxCc: 1500, since2019Oct: 30500, before: 34500, heavy: 39600, commercial: 8500, commercialHeavy: 9700 },
  { maxCc: 2000, since2019Oct: 36000, before: 39500, heavy: 45400, commercial: 9500, commercialHeavy: 10900 },
  { maxCc: 2500, since2019Oct: 43500, before: 45000, heavy: 51700, commercial: 13800, commercialHeavy: 15800 },
  { maxCc: 3000, since2019Oct: 50000, before: 51000, heavy: 58600, commercial: 15700, commercialHeavy: 18000 },
  { maxCc: 3500, since2019Oct: 57000, before: 58000, heavy: 66700, commercial: 17900, commercialHeavy: 20500 },
  { maxCc: 4000, since2019Oct: 65500, before: 66500, heavy: 76400, commercial: 20500, commercialHeavy: 23500 },
  { maxCc: 4500, since2019Oct: 75500, before: 76500, heavy: 87900, commercial: 23600, commercialHeavy: 27100 },
  { maxCc: 6000, since2019Oct: 87000, before: 88000, heavy: 101200, commercial: 27200, commercialHeavy: 31200 },
  { maxCc: Infinity, since2019Oct: 110000, before: 111000, heavy: 127600, commercial: 40700, commercialHeavy: 46800 },
];

/** 貨物車（最大積載量 1t ごと、8t まで）。8t を超えると 1t ごとに加算 */
const CARGO_TAX = {
  private: { upTo8t: [8000, 11500, 16000, 20500, 25500, 30000, 35000, 40500], perTonOver8t: 6300 },
  commercial: { upTo8t: [6500, 9000, 12000, 15000, 18500, 22000, 25500, 29500], perTonOver8t: 4700 },
};

/** 貨客兼用車（乗車定員4人以上の貨物車）は、同じ積載量の貨物車の税額に、排気量ごとの額を足す（1L以下・1.5L以下・1.5L超） */
const DUAL_PURPOSE_ADD = { private: [5200, 6300, 8000], commercial: [3700, 4700, 6300] };

/** 自家用バス（乗車定員30人以下・40人以下・50人以下） */
const PRIVATE_BUS_TAX = [33000, 41000, 49000];

/** 軽自動車税（四輪）。2015-04 以後の初度検査・それより前・13年超 */
const KEI_TAX: Record<'privatePassenger' | 'commercialPassenger' | 'privateCargo' | 'commercialCargo', { since2015Apr: number; before: number; heavy: number }> = {
  privatePassenger: { since2015Apr: 10800, before: 7200, heavy: 12900 },
  commercialPassenger: { since2015Apr: 6900, before: 5500, heavy: 8200 },
  privateCargo: { since2015Apr: 5000, before: 4000, heavy: 6000 },
  commercialCargo: { since2015Apr: 3800, before: 3000, heavy: 4500 },
};

/**
 * 都道府県ごとの税率（標準税率に掛ける倍率）。標準税率と違う県があれば行を足す。
 * 2026-11 時点で調べた県（石川・静岡・福井・埼玉・千葉・京都・栃木・和歌山・沖縄・北海道ほか）はいずれも標準税率。
 * 47都道府県すべては確かめられていない（docs/open-questions.md の 70）
 */
export const PREFECTURE_TAX_RATE: Partial<Record<Prefecture, number>> = {};

/** 県ごとの倍率を掛ける（100円未満切り捨て）。表に無い県は標準税率のまま */
export function applyPrefectureRate(amountYen: number, prefecture: Prefecture | null | undefined, table: Partial<Record<Prefecture, number>> = PREFECTURE_TAX_RATE): number {
  const rate = prefecture ? table[prefecture] : undefined;
  return rate == null || rate === 1 ? amountYen : Math.floor((amountYen * rate) / 100) * 100;
}

/** 重課の額（10%・15%）。100円未満切り捨て */
function heavier(amountYen: number, percent: number): number {
  return Math.floor((amountYen * (100 + percent)) / 100 / 100) * 100;
}

/** 初度登録から years 年を過ぎてから最初の4月1日の年度から重課（例：2012年6月登録・13年 → 2026年度から） */
function heavyFromFiscalYear(firstRegisteredOn: IsoDate, years: number): number {
  const elapsed = addMonths(firstRegisteredOn.slice(0, 7) + '-01', years * 12);
  // 経過した月が4月より前ならその年の4月、4月以後なら翌年の4月が最初の4月1日
  return Number(elapsed.slice(5, 7)) < 4 ? Number(elapsed.slice(0, 4)) : Number(elapsed.slice(0, 4)) + 1;
}

/** 経年による重課の対象か（ハイブリッド・電気は対象外。ガソリンは13年、普通車・小型車のディーゼルは11年） */
function isHeavyAutomobileTax(spec: VehicleTaxSpec, fiscalYear: number): boolean {
  if (!spec.firstRegisteredOn || spec.powertrain === 'hybrid' || spec.powertrain === 'electric') return false;
  const years = spec.vehicleClass === 'standard' && spec.powertrain === 'diesel' ? 11 : 13;
  return fiscalYear >= heavyFromFiscalYear(spec.firstRegisteredOn, years);
}

export interface VehicleTaxAmount {
  amountYen: number;
  /** 経年で重くなった税額か */
  heavy: boolean;
}

function validPositive(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n > 0;
}

function standardAutomobileTax(spec: VehicleTaxSpec, heavy: boolean): number | null {
  const commercial = spec.businessClass === 'commercial';
  const usage = spec.usage ?? 'passenger';
  // 電気自動車は 1,000cc 以下の税額
  const cc = spec.powertrain === 'electric' ? 1 : spec.displacementCc;
  if (usage === 'passenger') {
    if (!validPositive(cc)) return null;
    const row = PASSENGER_TAX.find((r) => cc <= r.maxCc)!;
    if (commercial) return heavy ? row.commercialHeavy : row.commercial;
    if (heavy) return row.heavy;
    return spec.firstRegisteredOn! >= '2019-10-01' ? row.since2019Oct : row.before;
  }
  if (usage === 'cargo') {
    const load = spec.maxLoadKg;
    if (load == null || !Number.isFinite(load) || load < 0) return null;
    const t = CARGO_TAX[commercial ? 'commercial' : 'private'];
    const tons = Math.max(1, Math.ceil(load / 1000));
    const pct = heavy ? 10 : 0;
    const base = tons <= 8 ? heavier(t.upTo8t[tons - 1], pct) : heavier(t.upTo8t[7], pct) + heavier(t.perTonOver8t, pct) * (tons - 8);
    const seats = spec.seatingCapacity;
    if (seats == null || seats < 4) return base;
    // 貨客兼用車：重課の額は確かめられていないので出さない
    if (heavy || !validPositive(cc)) return null;
    const add = DUAL_PURPOSE_ADD[commercial ? 'commercial' : 'private'];
    return base + (cc <= 1000 ? add[0] : cc <= 1500 ? add[1] : add[2]);
  }
  if (usage === 'bus') {
    const seats = spec.seatingCapacity;
    // 事業用のバスは一般乗合用かどうかで税額が違い、車検証から分からないので出さない
    if (commercial || seats == null || seats < 1 || seats > 50) return null;
    const base = PRIVATE_BUS_TAX[seats <= 30 ? 0 : seats <= 40 ? 1 : 2];
    return heavy ? heavier(base, 10) : base;
  }
  // 特種用途車（キャンピング車など）は対応していない
  return null;
}

/** その年度の自動車税（軽自動車税）の年額。車検証の項目が足りない・対応していない区分なら null */
export function automobileTaxFor(spec: VehicleTaxSpec, fiscalYear: number): VehicleTaxAmount | null {
  if (!spec.vehicleClass || !spec.firstRegisteredOn || !spec.powertrain) return null;
  const heavy = isHeavyAutomobileTax(spec, fiscalYear);
  if (spec.vehicleClass === 'kei') {
    const usage = spec.usage ?? 'passenger';
    if (usage !== 'passenger' && usage !== 'cargo') return null;
    const commercial = spec.businessClass === 'commercial';
    const t = KEI_TAX[`${commercial ? 'commercial' : 'private'}${usage === 'cargo' ? 'Cargo' : 'Passenger'}`];
    // 軽自動車税は市町村税。標準税率を超える市町村は無い（docs/open-questions.md の 70）
    return { amountYen: heavy ? t.heavy : spec.firstRegisteredOn >= '2015-04-01' ? t.since2015Apr : t.before, heavy };
  }
  const amount = standardAutomobileTax(spec, heavy);
  return amount == null ? null : { amountYen: applyPrefectureRate(amount, spec.prefecture), heavy };
}

type WeightRates = { eco: number | null; normal: number; over13: number; over18: number };

/** 自動車重量税（継続検査）の1年あたりの単価 */
const WEIGHT_TAX_PER_YEAR = {
  /** 自家用乗用：車両重量 0.5t ごと */
  privatePassengerPerHalfTon: { eco: 2500, normal: 4100, over13: 5700, over18: 6300 },
  /** 事業用乗用：車両重量 0.5t ごと（本則税率は確かめられていない） */
  commercialPassengerPerHalfTon: { eco: null, normal: 2600, over13: 2700, over18: 2800 },
  /** 自家用貨物：車両総重量 1t ごと。2.5t 以下と 2.5t 超で単価が違う */
  privateCargoPerTonUpTo2500: { eco: null, normal: 3300, over13: 4100, over18: 4400 },
  privateCargoPerTonOver2500: { eco: null, normal: 4100, over13: 5700, over18: 6300 },
  /** 事業用貨物：車両総重量 1t ごと */
  commercialCargoPerTon: { eco: null, normal: 2600, over13: 2700, over18: 2800 },
  /** 軽自動車：1台あたり */
  privateKei: { eco: 2500, normal: 3300, over13: 4100, over18: 4400 },
  commercialKei: { eco: null, normal: 2600, over13: 2700, over18: 2800 },
} satisfies Record<string, WeightRates>;

/** 車検（継続検査）の日の時点で、初度登録から何年たったかの区分 */
function weightTaxAge(firstRegisteredOn: IsoDate, inspectedOn: IsoDate): 'normal' | 'over13' | 'over18' {
  const reg = firstRegisteredOn.slice(0, 7) + '-01';
  const month = inspectedOn.slice(0, 7) + '-01';
  if (addMonths(reg, 18 * 12) <= month) return 'over18';
  if (addMonths(reg, 13 * 12) <= month) return 'over13';
  return 'normal';
}

/**
 * 継続検査の車検の有効期間（年）。自家用乗用・軽は2年、事業用乗用・貨物（軽を除く）は1年。
 * 貨物車の初回（新車から最初の車検）は2年の場合があるが、継続検査として1年で計算する
 */
export function inspectionYears(spec: VehicleTaxSpec): number {
  if (spec.vehicleClass === 'kei') return 2;
  if ((spec.usage ?? 'passenger') === 'cargo') return 1;
  return spec.businessClass === 'commercial' ? 1 : 2;
}

export interface WeightTaxAmount extends VehicleTaxAmount {
  /** 計算に使った車検の有効期間（年） */
  years: number;
}

/**
 * 車検のときに払う重量税（継続検査）。years を渡さなければ、区分ごとの有効期間（inspectionYears）で計算する。
 * 電気自動車は本則税率（エコカー減税の免税は入れていない）、ハイブリッド・電気は経年の重課なし。
 * 対応していない区分（バス・特種、事業用・貨物の電気自動車）は null
 */
export function weightTaxFor(spec: VehicleTaxSpec, inspectedOn: IsoDate, years?: number): WeightTaxAmount | null {
  if (!spec.vehicleClass || !spec.firstRegisteredOn || !spec.powertrain) return null;
  const usage = spec.usage ?? 'passenger';
  if (usage !== 'passenger' && usage !== 'cargo') return null;
  const commercial = spec.businessClass === 'commercial';
  const y = years ?? inspectionYears(spec);
  const eco = spec.powertrain === 'electric';
  const age = spec.powertrain === 'hybrid' || eco ? 'normal' : weightTaxAge(spec.firstRegisteredOn, inspectedOn);
  const heavy = !eco && age !== 'normal';
  const rate = (t: WeightRates): number | null => (eco ? t.eco : t[age]);

  if (spec.vehicleClass === 'kei') {
    const r = rate(commercial ? WEIGHT_TAX_PER_YEAR.commercialKei : WEIGHT_TAX_PER_YEAR.privateKei);
    return r == null ? null : { amountYen: r * y, heavy, years: y };
  }
  if (usage === 'passenger') {
    const kg = spec.vehicleWeightKg;
    if (!validPositive(kg)) return null;
    const r = rate(commercial ? WEIGHT_TAX_PER_YEAR.commercialPassengerPerHalfTon : WEIGHT_TAX_PER_YEAR.privatePassengerPerHalfTon);
    return r == null ? null : { amountYen: r * Math.ceil(kg / 500) * y, heavy, years: y };
  }
  const gross = spec.grossWeightKg;
  if (!validPositive(gross)) return null;
  const table = commercial
    ? WEIGHT_TAX_PER_YEAR.commercialCargoPerTon
    : gross <= 2500
      ? WEIGHT_TAX_PER_YEAR.privateCargoPerTonUpTo2500
      : WEIGHT_TAX_PER_YEAR.privateCargoPerTonOver2500;
  const r = rate(table);
  return r == null ? null : { amountYen: r * Math.ceil(gross / 1000) * y, heavy, years: y };
}

/** 「1,500cc・2015年6月登録・ガソリン」のように、計算に使った車検証の項目を書く */
export function vehicleTaxSpecLabel(spec: VehicleTaxSpec, withWeight = false): string {
  const parts: string[] = [];
  const commercial = spec.businessClass === 'commercial' ? '事業用' : '';
  const usage = spec.usage ?? 'passenger';
  if (usage !== 'passenger' || commercial) parts.push(`${commercial}${usage === 'cargo' ? '貨物' : usage === 'bus' ? 'バス' : usage === 'special' ? '特種' : '乗用'}`);
  if (spec.vehicleClass === 'kei') parts.push('軽自動車');
  else if (spec.powertrain !== 'electric' && spec.displacementCc != null) parts.push(`${spec.displacementCc.toLocaleString('ja-JP')}cc`);
  if (usage === 'cargo' && spec.vehicleClass === 'standard' && spec.maxLoadKg != null) parts.push(`積載${spec.maxLoadKg.toLocaleString('ja-JP')}kg`);
  if (usage === 'bus' && spec.seatingCapacity != null) parts.push(`${spec.seatingCapacity}人`);
  if (withWeight && spec.vehicleClass === 'standard') {
    const kg = usage === 'cargo' ? spec.grossWeightKg : spec.vehicleWeightKg;
    if (kg != null) parts.push(`${usage === 'cargo' ? '総重量' : ''}${kg.toLocaleString('ja-JP')}kg`);
  }
  if (spec.firstRegisteredOn) parts.push(`${Number(spec.firstRegisteredOn.slice(0, 4))}年${Number(spec.firstRegisteredOn.slice(5, 7))}月登録`);
  if (spec.powertrain) parts.push(POWERTRAIN_LABELS[spec.powertrain]);
  return parts.join('・');
}

const ERAS: Record<string, number> = { 令和: 2018, R: 2018, 平成: 1988, H: 1988, 昭和: 1925, S: 1925 };

/**
 * 初度登録年月の入力を 'YYYY-MM-01' にする。車検証の和暦のまま入れられる。
 * 例：「令和2年6月」「R2.6」「H27/10」「2020/6」「2020-06」「2020年6月」。読めなければ null
 */
export function parseYearMonth(text: string): IsoDate | null {
  const s = text
    .normalize('NFKC')
    .replace(/\s/g, '')
    .replace(/元年/, '1年')
    .toUpperCase()
    .replace(/[年./／-]/g, '/')
    .replace(/月$/, '');
  const m = s.match(/^(令和|平成|昭和|R|H|S)?(\d{1,4})\/(\d{1,2})$/);
  if (!m) return null;
  const n = Number(m[2]);
  const year = m[1] ? ERAS[m[1]] + n : n;
  const month = Number(m[3]);
  if (m[1] && (n < 1 || n > 64)) return null;
  if (!m[1] && m[2].length !== 4) return null;
  if (year < 1950 || year > 2100 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** 年月日の入力を 'YYYY-MM-DD' にする。和暦のままでもよい（例：「令和9年6月30日」「R9.6.30」「2027/6/30」）。読めなければ null */
export function parseYearMonthDay(text: string): IsoDate | null {
  const s = text.normalize('NFKC').replace(/\s/g, '').replace(/元年/, '1年').toUpperCase().replace(/日$/, '');
  const m = s.match(/^(.*?)[年./／-](\d{1,2})[月./／-](\d{1,2})$/);
  if (!m) return null;
  const ym = parseYearMonth(`${m[1]}/${m[2]}`);
  if (!ym) return null;
  const day = Number(m[3]);
  const y = Number(ym.slice(0, 4));
  const mo = Number(ym.slice(5, 7));
  const t = new Date(Date.UTC(y, mo - 1, day));
  if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== day) return null;
  return `${ym.slice(0, 8)}${String(day).padStart(2, '0')}`;
}
