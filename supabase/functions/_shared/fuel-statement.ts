/**
 * 掛けカード（ガソリンスタンドの後払いのカード）の月の明細から読み取った給油の行。アプリとサーバーで共有する。
 * - サーバー：AI が読んだ値の範囲・形を確かめる（sanitizeStatementRows）
 * - アプリ：登録済みの給油と重なる行を見つける（matchesExistingFill）、合計を出す
 */
import type { IsoDate } from './domain/dates.ts';
import { calculateFuelCost, isFuelType, isValidFuelLiters, isValidFuelUnitPrice, type FuelPriceBasis, type FuelType } from './domain/fuel.ts';

export interface StatementRow {
  date: IsoDate;
  /** 給油所の名前（無ければ null） */
  station: string | null;
  fuelType: FuelType | null;
  liters: number | null;
  /** 1Lあたりの単価（明細の表記のまま。税込か税抜かは basis） */
  unitPrice: number | null;
  /** 明細の行の金額（表記のまま） */
  amountYen: number | null;
}

export interface Statement {
  rows: StatementRow[];
  /** 明細の単価が税抜（消費税・軽油引取税を含まない）か。掛けカードの明細はふつう税抜 */
  basis: FuelPriceBasis;
  /** 明細の請求の合計（税込）。照らし合わせに使う。読めなければ null */
  totalYen: number | null;
}

function isRealDate(s: unknown): s is IsoDate {
  if (typeof s !== 'string') return false;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.getUTCMonth() === Number(m[2]) - 1 && t.getUTCDate() === Number(m[3]);
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[,\s円]/g, '')) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** AI が読んだ明細を確かめる。日付の無い行・未来の行・数の形がおかしい値は捨てる。最大100行 */
export function sanitizeStatement(raw: Record<string, unknown>, today: IsoDate): Statement {
  const rows: StatementRow[] = [];
  const list = Array.isArray(raw.rows) ? raw.rows : [];
  for (const r of list.slice(0, 100) as Record<string, unknown>[]) {
    if (!r || !isRealDate(r.date) || r.date > today) continue;
    const liters = num(r.liters);
    const unitPrice = num(r.unit_price);
    const amount = num(r.amount_yen);
    const station = typeof r.station === 'string' && r.station.trim() ? r.station.normalize('NFKC').trim().slice(0, 60) : null;
    const row: StatementRow = {
      date: r.date,
      station,
      fuelType: isFuelType(r.fuel_type) ? r.fuel_type : null,
      liters: liters != null && isValidFuelLiters(Math.round(liters * 100) / 100) ? Math.round(liters * 100) / 100 : null,
      unitPrice: unitPrice != null && isValidFuelUnitPrice(Math.round(unitPrice * 10) / 10) ? Math.round(unitPrice * 10) / 10 : null,
      amountYen: amount != null && Number.isInteger(amount) && amount > 0 && amount < 100_000_000 ? amount : null,
    };
    if (row.liters == null && row.amountYen == null) continue;
    rows.push(row);
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const total = num(raw.total_yen);
  return {
    rows,
    basis: raw.unit_price_includes_tax === true ? 'tax_included' : 'tax_excluded',
    totalYen: total != null && Number.isInteger(total) && total > 0 ? total : null,
  };
}

/**
 * 記録する金額（税込）。給油量と単価が読めていれば、税込・税抜に合わせて計算する（税抜なら消費税などを足す）。
 * 読めなければ、明細の行の金額（税抜なら消費税を足す）
 */
export function rowTotalYen(row: StatementRow, basis: FuelPriceBasis): number | null {
  if (row.liters != null && row.unitPrice != null) {
    return calculateFuelCost({ date: row.date, fuelType: row.fuelType ?? 'regular', liters: row.liters, unitPriceYen: row.unitPrice, basis }).totalYen;
  }
  if (row.amountYen == null) return null;
  return basis === 'tax_included' ? row.amountYen : row.amountYen + Math.floor(row.amountYen / 10);
}

/** 登録済みの給油と同じ行か（同じ日で、給油量が 0.05L 以内か、量が分からなければ金額が同じ） */
export function matchesExistingFill(row: StatementRow, totalYen: number | null, existing: { date: IsoDate; liters: number | null; amountYen: number }[]): boolean {
  return existing.some(
    (e) =>
      e.date === row.date &&
      ((row.liters != null && e.liters != null && Math.abs(e.liters - row.liters) <= 0.05) || (totalYen != null && e.amountYen === totalYen)),
  );
}
