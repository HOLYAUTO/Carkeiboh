/**
 * 確定申告・帳簿づけ用の計算。利用者には「入力した数字」と「計算後の数字」だけを見せ、
 * 税の区分・勘定科目・端数の扱いはここで決める（画面には出さない）。
 *
 * - かけ（掛けカードでの給油）は税抜の単価で入れてもらい、消費税などを足して税込にする
 * - 支出ごとに、消費税の額と「消費税のかからない分」（保険料・自動車税・軽油引取税・車検の法定費用）を分ける
 * - 仕事で使う割合（家事按分）を掛けて、経費にする額を出す
 * - 年（1月〜12月）ごとに勘定科目でまとめ、表（CSV）にする
 *
 * 区分・科目・端数はいずれも仮の値（社内資料/要確認一覧.md の 59〜63）。税理士の確認で変わりうる。
 */
import type { ExpenseCategory } from './costs.ts';
import type { IsoDate } from './dates.ts';
import { calculateFuelCost, fuelTaxRatesOn, type FuelPriceBasis, type FuelType } from './fuel.ts';

/** 消費税率（標準税率）の履歴。その日から適用 */
const CONSUMPTION_TAX_HISTORY: readonly { from: IsoDate; percent: number }[] = [
  { from: '1989-04-01', percent: 3 },
  { from: '1997-04-01', percent: 5 },
  { from: '2014-04-01', percent: 8 },
  { from: '2019-10-01', percent: 10 },
];

export function consumptionTaxPercentOn(date: IsoDate): number {
  return (CONSUMPTION_TAX_HISTORY.filter((r) => r.from <= date).at(-1) ?? CONSUMPTION_TAX_HISTORY[0]).percent;
}

/**
 * 項目ごとの勘定科目と、消費税がかかるか。
 * - taxable：消費税がかかる（税込の金額に消費税が含まれる）
 * - exempt：消費税がかからない（保険料は非課税、自動車税は不課税）
 */
export const CATEGORY_BOOKKEEPING: Record<ExpenseCategory, { account: string; taxable: boolean }> = {
  oil_change: { account: '車両費', taxable: true },
  fuel: { account: '車両費', taxable: true },
  maintenance: { account: '修繕費', taxable: true },
  // 車検の法定費用（重量税・自賠責保険料・印紙代）は消費税がかからない。exemptYen で分ける
  shaken: { account: '車両費', taxable: true },
  insurance: { account: '損害保険料', taxable: false },
  car_tax: { account: '租税公課', taxable: false },
  parking_toll: { account: '旅費交通費', taxable: true },
  // ローンの元金は経費にならない（利息は支払利息）。仮にリース料として数える（社内資料/要確認一覧.md の 61）
  loan_lease: { account: 'リース料', taxable: true },
  other: { account: '雑費', taxable: true },
};

/**
 * かけ（後払い）で記録できる項目。かけは掛けカード（ガソリンスタンドの後払いのカード）で給油するときだけ
 * （2026-11-08 たにぐち自動車：かけ払いはガソリンだけ）。前に給油以外をかけで記録した分も、帳簿ではそのまま数える
 */
export function canBeOnAccount(category: ExpenseCategory): boolean {
  return category === 'fuel';
}

/**
 * かけの請求書の税抜の金額から、税込の金額を出す（消費税は1円未満切り捨て）。
 * exemptYen は税抜の金額のうち消費税のかからない分（車検の法定費用など）
 */
export function withConsumptionTax(baseYen: number, date: IsoDate, exemptYen = 0): { totalYen: number; consumptionTaxYen: number } {
  const taxableYen = Math.max(0, baseYen - Math.max(0, exemptYen));
  const consumptionTaxYen = Math.floor((taxableYen * consumptionTaxPercentOn(date)) / 100);
  return { totalYen: baseYen + consumptionTaxYen, consumptionTaxYen };
}

export interface BookkeepingExpense {
  date: IsoDate;
  category: ExpenseCategory;
  /** 支払う合計（税込） */
  amountYen: number;
  /** かけ（後払い）か */
  onAccount: boolean;
  /** かけのとき、利用者が入れた税抜の金額（給油以外） */
  enteredAmountYen: number | null;
  /** 消費税のかからない分（車検の法定費用など）。分からなければ null */
  exemptYen: number | null;
  fuel: { fuelType: FuelType | null; liters: number | null; unitPrice: number | null; basis: FuelPriceBasis | null } | null;
  note: string | null;
}

export interface BookkeepingLine {
  date: IsoDate;
  category: ExpenseCategory;
  account: string;
  amountYen: number;
  /** 金額に含まれる消費税 */
  consumptionTaxYen: number;
  /** 消費税のかからない分 */
  exemptYen: number;
  onAccount: boolean;
  businessPercent: number;
  /** 経費にする額（金額 × 仕事で使う割合） */
  businessYen: number;
  /** 経費にする額に含まれる消費税 */
  businessConsumptionTaxYen: number;
  note: string | null;
}

/** 税込の金額に含まれる消費税（消費税のかからない分を除いて逆算。1円未満切り捨て） */
function includedTax(amountYen: number, exemptYen: number, date: IsoDate): number {
  const pct = consumptionTaxPercentOn(date);
  return Math.floor((Math.max(0, amountYen - exemptYen) * pct) / (100 + pct));
}

function clampPercent(p: number | null | undefined): number {
  if (p == null || !Number.isFinite(p)) return 100;
  return Math.min(100, Math.max(0, Math.round(p)));
}

/** 経費にする額（金額 × 仕事で使う割合、1円未満切り捨て）。割合が未設定なら全額 */
export function businessAmount(amountYen: number, businessPercent: number | null | undefined): number {
  return Math.floor((amountYen * clampPercent(businessPercent)) / 100);
}

/**
 * 支出1件を帳簿の1行にする。businessPercent は仕事で使う割合（未設定は 100%）。
 * 経費にする額は1円未満を切り捨てる。
 */
export function bookkeepingLine(e: BookkeepingExpense, businessPercent: number | null = null): BookkeepingLine {
  const { account, taxable } = CATEGORY_BOOKKEEPING[e.category];
  let exemptYen = 0;
  let consumptionTaxYen = 0;
  if (taxable) {
    const f = e.fuel;
    if (e.category === 'fuel' && f && f.liters != null && f.unitPrice != null && f.basis && f.fuelType) {
      const cost = calculateFuelCost({ date: e.date, fuelType: f.fuelType, liters: f.liters, unitPriceYen: f.unitPrice, basis: f.basis });
      // 軽油引取税は消費税がかからない。金額が計算と同じなら計算の消費税をそのまま使う（請求書の単価から足した額と合わせる）
      exemptYen = Math.min(cost.dieselDeliveryTaxYen, e.amountYen);
      consumptionTaxYen = cost.totalYen === e.amountYen ? cost.consumptionTaxYen : includedTax(e.amountYen, exemptYen, e.date);
    } else if (e.category === 'fuel' && f?.fuelType === 'diesel' && f.liters != null) {
      // 単価が無くても、量が分かれば軽油引取税は出せる
      exemptYen = Math.min(Math.floor((Math.round(f.liters * 100) * fuelTaxRatesOn(e.date).dieselDeliveryTax) / 10_000), e.amountYen);
      consumptionTaxYen = includedTax(e.amountYen, exemptYen, e.date);
    } else {
      exemptYen = Math.min(Math.max(0, e.exemptYen ?? 0), e.amountYen);
      // かけは税抜の金額に消費税を足して税込にしたので、その差が消費税
      consumptionTaxYen =
        e.onAccount && e.enteredAmountYen != null && e.enteredAmountYen <= e.amountYen
          ? e.amountYen - e.enteredAmountYen
          : includedTax(e.amountYen, exemptYen, e.date);
    }
  } else {
    exemptYen = e.amountYen;
  }
  const pct = clampPercent(businessPercent);
  return {
    date: e.date,
    category: e.category,
    account,
    amountYen: e.amountYen,
    consumptionTaxYen,
    exemptYen,
    onAccount: e.onAccount,
    businessPercent: pct,
    businessYen: businessAmount(e.amountYen, pct),
    businessConsumptionTaxYen: Math.floor((consumptionTaxYen * pct) / 100),
    note: e.note,
  };
}

export interface AccountTotal {
  account: string;
  amountYen: number;
  businessYen: number;
  consumptionTaxYen: number;
  count: number;
}

export interface AnnualBookkeeping {
  year: number;
  from: IsoDate;
  to: IsoDate;
  businessPercent: number;
  lines: BookkeepingLine[];
  /** 勘定科目ごと（経費にする額の大きい順） */
  byAccount: AccountTotal[];
  totalYen: number;
  businessYen: number;
  businessConsumptionTaxYen: number;
  /** かけ（後払い）で記録した件数と金額（年末に未払いが残っていないか確かめるため） */
  onAccountCount: number;
  onAccountYen: number;
}

/** 1年分（1月1日〜12月31日）の帳簿。確定申告は1月〜12月の分を翌年に申告する */
export function annualBookkeeping(expenses: BookkeepingExpense[], year: number, businessPercent: number | null = null): AnnualBookkeeping {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const lines = expenses
    .filter((e) => e.date >= from && e.date <= to)
    .map((e) => bookkeepingLine(e, businessPercent))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const totals = new Map<string, AccountTotal>();
  for (const l of lines) {
    const t = totals.get(l.account) ?? { account: l.account, amountYen: 0, businessYen: 0, consumptionTaxYen: 0, count: 0 };
    t.amountYen += l.amountYen;
    t.businessYen += l.businessYen;
    t.consumptionTaxYen += l.businessConsumptionTaxYen;
    t.count += 1;
    totals.set(l.account, t);
  }
  const onAccount = lines.filter((l) => l.onAccount);
  return {
    year,
    from,
    to,
    businessPercent: clampPercent(businessPercent),
    lines,
    byAccount: [...totals.values()].sort((a, b) => b.businessYen - a.businessYen),
    totalYen: lines.reduce((s, l) => s + l.amountYen, 0),
    businessYen: lines.reduce((s, l) => s + l.businessYen, 0),
    businessConsumptionTaxYen: lines.reduce((s, l) => s + l.businessConsumptionTaxYen, 0),
    onAccountCount: onAccount.length,
    onAccountYen: onAccount.reduce((s, l) => s + l.amountYen, 0),
  };
}

/** 確定申告の対象として最初に見せる年。1〜3月は申告の時期なので前の年、それ以外は今年 */
export function defaultBookkeepingYear(today: IsoDate): number {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month <= 3 ? year - 1 : year;
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 表計算ソフト・会計ソフトに取り込める CSV。明細のあとに勘定科目ごとの合計を付ける。
 * categoryLabel は項目の表示名（例：給油）。
 */
export function bookkeepingCsv(report: AnnualBookkeeping, categoryLabel: (c: ExpenseCategory) => string, title: string): string {
  const rows: (string | number)[][] = [
    [title],
    ['日付', '勘定科目', '項目', '支払い', '金額（税込）', 'うち消費税', '消費税のかからない分', '仕事で使う割合（%）', '経費にする額', '経費のうち消費税', 'メモ'],
    ...report.lines.map((l) => [
      l.date,
      l.account,
      categoryLabel(l.category),
      l.onAccount ? 'かけ' : 'その場で支払い',
      l.amountYen,
      l.consumptionTaxYen,
      l.exemptYen,
      l.businessPercent,
      l.businessYen,
      l.businessConsumptionTaxYen,
      l.note ?? '',
    ]),
    [],
    ['勘定科目', '件数', '金額（税込）', '経費にする額', '経費のうち消費税'],
    ...report.byAccount.map((t) => [t.account, t.count, t.amountYen, t.businessYen, t.consumptionTaxYen]),
    ['合計', report.lines.length, report.totalYen, report.businessYen, report.businessConsumptionTaxYen],
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
