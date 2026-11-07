/**
 * 自動車税（軽自動車税）と、車検のときの自動車重量税の自動計算。自家用の乗用車だけ。
 * 車検証の項目（種別・総排気量・初度登録年月・燃料・車両重量）を一度入れてもらえば、毎回の計算はアプリで行う。
 *
 * 税額は 2026-11 時点の標準税率（docs/open-questions.md の 66・67）。
 * - 自動車税：2019-10-01 以後に初度登録した車と、それより前の車で税額が違う。13年超（ディーゼルは11年超）は約15%重課
 *   （2026-04-01 に名称が「自動車税種別割」から「自動車税」に変わったが、税額は変わらない）
 * - 重量税：継続検査の「当分の間税率」（エコカーは本則税率）。13年・18年経過で重くなる
 * エコカー減税（重量税の免税・減免）、グリーン化特例（翌年度の軽課）、新車登録の年の月割、県ごとの超過課税は入れていない。
 * 税率が変わったら、下の表を直す。
 */
import { addMonths, type IsoDate } from './dates.ts';

export const VEHICLE_CLASSES = ['standard', 'kei'] as const;
/** standard：普通車・小型車（白・緑ナンバーではない自家用の登録車） / kei：軽自動車 */
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
  /** 車両重量（kg）。重量税で使う（軽自動車は使わない） */
  vehicleWeightKg: number | null;
}

/** 4月から翌年3月までの年度（自動車税は毎年4月1日の持ち主にかかる） */
export function fiscalYearOf(date: IsoDate): number {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? year : year - 1;
}

/** 排気量の上限（cc）と年税額。上限を超える最後の行は Infinity */
const AUTOMOBILE_TAX_TABLE: readonly { maxCc: number; since2019Oct: number; before: number; heavy: number }[] = [
  { maxCc: 1000, since2019Oct: 25000, before: 29500, heavy: 33900 },
  { maxCc: 1500, since2019Oct: 30500, before: 34500, heavy: 39600 },
  { maxCc: 2000, since2019Oct: 36000, before: 39500, heavy: 45400 },
  { maxCc: 2500, since2019Oct: 43500, before: 45000, heavy: 51700 },
  { maxCc: 3000, since2019Oct: 50000, before: 51000, heavy: 58600 },
  { maxCc: 3500, since2019Oct: 57000, before: 58000, heavy: 66700 },
  { maxCc: 4000, since2019Oct: 65500, before: 66500, heavy: 76400 },
  { maxCc: 4500, since2019Oct: 75500, before: 76500, heavy: 87900 },
  { maxCc: 6000, since2019Oct: 87000, before: 88000, heavy: 101200 },
  { maxCc: Infinity, since2019Oct: 110000, before: 111000, heavy: 127600 },
];

/** 軽自動車税（自家用の乗用・四輪）。2015-04 以後の初度検査は 10,800円、それより前は 7,200円、13年超は 12,900円 */
const KEI_TAX = { since2015Apr: 10800, before: 7200, heavy: 12900 };

/** 初度登録から years 年を過ぎてから最初の4月1日の年度から重課（例：2012年6月登録・13年 → 2026年度から） */
function heavyFromFiscalYear(firstRegisteredOn: IsoDate, years: number): number {
  const elapsed = addMonths(firstRegisteredOn.slice(0, 7) + '-01', years * 12);
  // 経過した月が4月より前ならその年の4月、4月以後なら翌年の4月が最初の4月1日
  return Number(elapsed.slice(5, 7)) < 4 ? Number(elapsed.slice(0, 4)) : Number(elapsed.slice(0, 4)) + 1;
}

/** 経年による重課の対象か（ハイブリッド・電気は対象外。ガソリンは13年、ディーゼルは11年） */
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

/** その年度の自動車税（軽自動車税）の年額。車検証の項目が足りなければ null */
export function automobileTaxFor(spec: VehicleTaxSpec, fiscalYear: number): VehicleTaxAmount | null {
  if (!spec.vehicleClass || !spec.firstRegisteredOn || !spec.powertrain) return null;
  const heavy = isHeavyAutomobileTax(spec, fiscalYear);
  if (spec.vehicleClass === 'kei') {
    if (heavy) return { amountYen: KEI_TAX.heavy, heavy };
    return { amountYen: spec.firstRegisteredOn >= '2015-04-01' ? KEI_TAX.since2015Apr : KEI_TAX.before, heavy };
  }
  // 電気自動車は 1,000cc 以下の税額
  const cc = spec.powertrain === 'electric' ? 1 : spec.displacementCc;
  if (cc == null || !Number.isFinite(cc) || cc <= 0) return null;
  const row = AUTOMOBILE_TAX_TABLE.find((r) => cc <= r.maxCc)!;
  if (heavy) return { amountYen: row.heavy, heavy };
  return { amountYen: spec.firstRegisteredOn >= '2019-10-01' ? row.since2019Oct : row.before, heavy };
}

/**
 * 自動車重量税（自家用乗用・継続検査）の1年あたりの税額。
 * 普通車・小型車は 0.5t ごと、軽自動車は1台あたり。
 */
const WEIGHT_TAX_PER_YEAR = {
  standardPerHalfTon: { eco: 2500, normal: 4100, over13: 5700, over18: 6300 },
  kei: { eco: 2500, normal: 3300, over13: 4100, over18: 4400 },
};

/** 車検（継続検査）の日の時点で、初度登録から何年たったかの区分 */
function weightTaxAge(firstRegisteredOn: IsoDate, inspectedOn: IsoDate): 'normal' | 'over13' | 'over18' {
  const reg = firstRegisteredOn.slice(0, 7) + '-01';
  const month = inspectedOn.slice(0, 7) + '-01';
  if (addMonths(reg, 18 * 12) <= month) return 'over18';
  if (addMonths(reg, 13 * 12) <= month) return 'over13';
  return 'normal';
}

/**
 * 車検のときに払う重量税（継続検査、自家用乗用）。years は車検の有効期間（自家用乗用は2年）。
 * 電気自動車は本則税率（エコカー減税の免税は入れていない）、ハイブリッド・電気は経年の重課なし。
 */
export function weightTaxFor(spec: VehicleTaxSpec, inspectedOn: IsoDate, years = 2): VehicleTaxAmount | null {
  if (!spec.vehicleClass || !spec.firstRegisteredOn || !spec.powertrain) return null;
  const eco = spec.powertrain === 'electric';
  const age = spec.powertrain === 'hybrid' || eco ? 'normal' : weightTaxAge(spec.firstRegisteredOn, inspectedOn);
  const pick = (t: { eco: number; normal: number; over13: number; over18: number }) => (eco ? t.eco : t[age]);
  const heavy = !eco && age !== 'normal';
  if (spec.vehicleClass === 'kei') return { amountYen: pick(WEIGHT_TAX_PER_YEAR.kei) * years, heavy };
  const kg = spec.vehicleWeightKg;
  if (kg == null || !Number.isFinite(kg) || kg <= 0) return null;
  const halfTons = Math.ceil(kg / 500);
  return { amountYen: pick(WEIGHT_TAX_PER_YEAR.standardPerHalfTon) * halfTons * years, heavy };
}

/** 「1,500cc・2015年6月登録・ガソリン」のように、計算に使った車検証の項目を書く */
export function vehicleTaxSpecLabel(spec: VehicleTaxSpec, withWeight = false): string {
  const parts: string[] = [];
  if (spec.vehicleClass === 'kei') parts.push('軽自動車');
  else if (spec.powertrain !== 'electric' && spec.displacementCc != null) parts.push(`${spec.displacementCc.toLocaleString('ja-JP')}cc`);
  if (withWeight && spec.vehicleClass === 'standard' && spec.vehicleWeightKg != null) parts.push(`${spec.vehicleWeightKg.toLocaleString('ja-JP')}kg`);
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
