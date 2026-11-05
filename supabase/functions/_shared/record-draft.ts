/**
 * 写真・音声から読み取った「記録の下書き」。フォームに入れる前の値で、利用者が確かめてから保存する。
 * アプリ（音声の解析）と Edge Function（写真の読み取り結果の検証）の両方から使うので、外部パッケージに依存しない。
 */
import { EXPENSE_CATEGORIES, type ExpenseCategory } from './domain/costs.ts';
import { addDays, diffDays, isIsoDate, type IsoDate } from './domain/dates.ts';
import { isFuelType, isValidFuelLiters, isValidFuelUnitPrice, type FuelType } from './domain/fuel.ts';

export type DraftCategory = ExpenseCategory | 'odometer';

export interface RecordDraft {
  date?: IsoDate;
  amountYen?: number;
  /** メーターに出ている総走行距離の数（車両の単位のまま。mile の車両なら mile） */
  odo?: number;
  filterChanged?: boolean;
  /** 給油量（L） */
  fuelLiters?: number;
  /** 1Lあたりの単価（円）。レシート・店頭の単価なので税込として扱う */
  fuelUnitPrice?: number;
  fuelType?: FuelType;
  /** 満タンにしたか */
  fullTank?: boolean;
  note?: string;
  /** 内容から推定した項目。選んでいる項目と違えば利用者に知らせる */
  category?: DraftCategory;
}

const DRAFT_CATEGORIES: readonly string[] = [...EXPENSE_CATEGORIES, 'odometer'];
const MAX_AMOUNT_YEN = 99_999_999;
const MAX_ODO_KM = 2_000_000;
/** 記録として受け付ける日付の範囲（未来は翌日まで、過去は10年まで） */
const MAX_PAST_DAYS = 3660;

function validDate(value: unknown, today: IsoDate): IsoDate | undefined {
  if (typeof value !== 'string' || !isIsoDate(value)) return undefined;
  const days = diffDays(today, value);
  return days <= 1 && days >= -MAX_PAST_DAYS ? value : undefined;
}

function validInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.round(value);
  return n >= min && n <= max ? n : undefined;
}

function roundTo(value: unknown, digits: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** 外から来た値（写真の読み取り結果など）を、フォームに入れてよい値だけに絞る */
export function sanitizeDraft(input: Record<string, unknown>, today: IsoDate): RecordDraft {
  const draft: RecordDraft = {};
  const date = validDate(input.date, today);
  if (date) draft.date = date;
  const amount = validInt(input.amountYen, 1, MAX_AMOUNT_YEN);
  if (amount != null) draft.amountYen = amount;
  const odo = validInt(input.odo, 0, MAX_ODO_KM);
  if (odo != null) draft.odo = odo;
  if (typeof input.filterChanged === 'boolean') draft.filterChanged = input.filterChanged;
  const liters = roundTo(input.fuelLiters, 2);
  if (liters != null && isValidFuelLiters(liters)) draft.fuelLiters = liters;
  const price = roundTo(input.fuelUnitPrice, 1);
  if (price != null && isValidFuelUnitPrice(price)) draft.fuelUnitPrice = price;
  if (isFuelType(input.fuelType)) draft.fuelType = input.fuelType;
  if (typeof input.fullTank === 'boolean') draft.fullTank = input.fullTank;
  if (typeof input.note === 'string' && input.note.trim()) draft.note = input.note.trim().slice(0, 200);
  if (typeof input.category === 'string' && DRAFT_CATEGORIES.includes(input.category)) draft.category = input.category as DraftCategory;
  return draft;
}

// ---------------------------------------------------------------------------
// 音声の解析
// ---------------------------------------------------------------------------

const KANJI_DIGITS: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const SMALL_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const NUM = '[0-9.〇零一二三四五六七八九十百千万]+';

/** 「4500」「4千500」「1万2000」「1.2万」「三千五百」のような数を読む。読めなければ null */
export function parseJapaneseNumber(token: string): number | null {
  const n = parseJapaneseDecimal(token);
  return n == null ? null : Math.round(n);
}

/** parseJapaneseNumber と同じだが、小数を残す（「30.5リットル」「172.5円」） */
export function parseJapaneseDecimal(token: string): number | null {
  let total = 0;
  let section = 0;
  let digits = '';
  for (const ch of token) {
    if (/[0-9.]/.test(ch)) digits += ch;
    else if (ch in KANJI_DIGITS) digits += String(KANJI_DIGITS[ch]);
    else if (ch in SMALL_UNITS) {
      section += (digits ? Number(digits) : 1) * SMALL_UNITS[ch];
      digits = '';
    } else if (ch === '万') {
      const value = section + (digits ? Number(digits) : 0);
      total += (value || 1) * 10_000;
      section = 0;
      digits = '';
    } else return null;
  }
  const result = total + section + (digits ? Number(digits) : 0);
  return Number.isFinite(result) ? result : null;
}

function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ｋＫ][ｍＭ]/g, 'km')
    .replace(/[Ｌℓ]/g, 'L')
    .replace(/(\d)[,，](?=\d)/g, '$1')
    .replace(/[．]/g, '.')
    .replace(/　/g, ' ');
}

const CATEGORY_KEYWORDS: [DraftCategory, RegExp][] = [
  ['oil_change', /オイル/],
  ['fuel', /ガソリン|給油|ハイオク|レギュラー|軽油|ディーゼル|満タン|リットル|リッター/],
  ['shaken', /車検/],
  ['insurance', /保険/],
  ['car_tax', /自動車税|税金/],
  ['parking_toll', /駐車|パーキング|高速|有料道路|ETC|通行料/i],
  ['loan_lease', /ローン|リース/],
  ['maintenance', /整備|点検|修理|タイヤ|バッテリー|ワイパー|ブレーキ|洗車/],
];

/** メモに残しても意味のない言葉（項目名と同じことしか言っていない） */
const FILLER = /^(ガソリン|給油|ハイオク|レギュラー|軽油|ディーゼル|満タン|単価|オイル|交換|走行距離|メーター|で|を|は|が|の|と|に|した|です|入れた|払った|\s)*$/;

/** 油種の言い方。ハイオクを先に見る（「レギュラーじゃなくハイオク」のような言い方は考えない） */
const FUEL_TYPE_KEYWORDS: [FuelType, RegExp][] = [
  ['premium', /ハイオク|プレミアム/],
  ['regular', /レギュラー/],
  ['diesel', /軽油|ディーゼル/],
];

function fuelTypeIn(text: string): FuelType | undefined {
  return FUEL_TYPE_KEYWORDS.find(([, re]) => re.test(text))?.[0];
}

/** 単価として受け付ける範囲（円/L）。これより外の値は単価とみなさない */
const MIN_UNIT_PRICE = 50;
const MAX_UNIT_PRICE = 500;

/**
 * 音声で話した内容から下書きを作る。例：「昨日ガソリン満タンで4500円、走行距離41200キロ」
 * 日付は「今日・昨日・おととい・N日前・M月D日」を読む。年がなく未来になる日付は前の年とみなす。
 */
export function parseSpokenRecord(text: string, today: IsoDate): RecordDraft {
  let rest = normalize(text);
  const draft: RecordDraft = {};
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(rest);
    if (m) rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
    return m;
  };

  // 単価（「単価172円」「リッター172円」「1リットルあたり172.5円」「172円/L」）は合計の金額より先に取る
  const unitPrice =
    // 「30リットル 172円」の「リットル」は量の単位なので、数の直後のリットルは単価の目印にしない
    take(
      new RegExp(
        `(?:単価|1\\s*(?:リッター|リットル|L)\\s*(?:あたり|当たり)|(?<!${NUM}\\s*)(?:リッター|リットル)\\s*(?:あたり|当たり)?)\\s*(?:は|が)?\\s*(${NUM})\\s*(?:円|えん)`,
      ),
    ) ??
    take(new RegExp(`(${NUM})\\s*(?:円|えん)\\s*(?:/|／|毎|パー)\\s*(?:リッター|リットル|L)`));
  if (unitPrice) {
    const n = parseJapaneseDecimal(unitPrice[1]);
    if (n != null && isValidFuelUnitPrice(Math.round(n * 10) / 10)) draft.fuelUnitPrice = Math.round(n * 10) / 10;
  }
  const liters = take(new RegExp(`(${NUM})\\s*(?:リットル|リッター|L)(?![a-zA-Z])`));
  if (liters) {
    const n = parseJapaneseDecimal(liters[1]);
    if (n != null && isValidFuelLiters(Math.round(n * 100) / 100)) draft.fuelLiters = Math.round(n * 100) / 100;
  }

  const yen = take(new RegExp(`(${NUM})\\s*(?:円|えん)`)) ?? take(new RegExp(`[¥￥]\\s*(${NUM})`));
  if (yen) {
    const n = parseJapaneseNumber(yen[1]);
    // 「30リットル 172円」のように量と一緒に言った小さな金額は、合計ではなく単価とみなす
    if (n != null && draft.fuelLiters != null && draft.fuelUnitPrice == null && n >= MIN_UNIT_PRICE && n <= MAX_UNIT_PRICE) {
      draft.fuelUnitPrice = n;
    } else if (n != null && n > 0 && n <= MAX_AMOUNT_YEN) draft.amountYen = n;
  }

  const odo =
    take(new RegExp(`(${NUM})\\s*(?:km|キロメートル|キロ|マイル|miles?|mi)(?![a-z])`, 'i')) ??
    take(new RegExp(`(?:走行距離|メーター|ODO|オドメーター)\\s*(?:は|が)?\\s*(${NUM})`, 'i'));
  if (odo) {
    const n = parseJapaneseNumber(odo[1]);
    if (n != null && n >= 0 && n <= MAX_ODO_KM) draft.odo = n;
  }

  const relative: [RegExp, number][] = [
    [/一昨日|おととい/, -2],
    [/昨日|きのう/, -1],
    [/今日|きょう/, 0],
  ];
  for (const [re, days] of relative) {
    if (take(re)) {
      draft.date = addDays(today, days);
      break;
    }
  }
  if (!draft.date) {
    const ago = take(new RegExp(`(${NUM})\\s*日前`));
    const n = ago ? parseJapaneseNumber(ago[1]) : null;
    if (n != null && n <= MAX_PAST_DAYS) draft.date = addDays(today, -n);
  }
  if (!draft.date) {
    const md = take(new RegExp(`(?:(\\d{4})\\s*年\\s*)?(${NUM})\\s*月\\s*(${NUM})\\s*日`));
    if (md) {
      const month = parseJapaneseNumber(md[2]);
      const day = parseJapaneseNumber(md[3]);
      let year = md[1] ? Number(md[1]) : Number(today.slice(0, 4));
      const build = () => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (month != null && day != null && isIsoDate(build())) {
        if (!md[1] && diffDays(today, build()) > 0) year -= 1;
        const date = validDate(build(), today);
        if (date) draft.date = date;
      }
    }
  }

  const fuelType = fuelTypeIn(rest);
  if (fuelType) draft.fuelType = fuelType;
  if (/満タン/.test(rest)) draft.fullTank = true;

  const filterNo = /(?:フィルター|エレメント)\s*(?:は|も)?\s*(?:交換\s*)?(?:なし|して(?:い)?ない|しなかった|そのまま)/;
  if (filterNo.test(rest)) draft.filterChanged = false;
  else if (/フィルター|エレメント/.test(rest)) draft.filterChanged = true;

  for (const [category, re] of CATEGORY_KEYWORDS) {
    if (re.test(rest)) {
      draft.category = category;
      break;
    }
  }
  if (!draft.category && (draft.fuelLiters != null || draft.fuelUnitPrice != null)) draft.category = 'fuel';
  if (!draft.category && draft.odo != null && draft.amountYen == null) draft.category = 'odometer';

  const note = rest.replace(/[、。,.!?！？「」]/g, ' ').replace(/\s+/g, ' ').trim();
  if (note && !FILLER.test(note)) draft.note = note.slice(0, 200);
  return draft;
}

// ---------------------------------------------------------------------------
// 端末の文字認識（OCR）で読んだ写真の解析
// ---------------------------------------------------------------------------

/** 支払った合計が書かれた行の目印。小計・税・お預り・お釣りの行は使わない */
const TOTAL_LINE = /合計|お?買上|領収金額|お支払|ご?請求|総額|現計|税込/;
const NOT_TOTAL_LINE = /小計|内税|消費税|税額|対象|ポイント|お?預り|お?預かり|釣|割引|値引|単価|数量|給油量/;
const AMOUNT = /[¥￥]?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*円?/g;

function amountsIn(line: string): number[] {
  return [...line.matchAll(AMOUNT)].map((m) => Number(m[1].replace(/,/g, ''))).filter((n) => n > 0 && n <= MAX_AMOUNT_YEN);
}

function receiptDate(lines: string[], today: IsoDate): IsoDate | undefined {
  const build = (y: number, m: number, d: number) => validDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, today);
  for (const line of lines) {
    // 2026/10/24・2026-10-24・2026.10.24・2026年10月24日
    let m = /(20\d{2})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/.exec(line);
    if (m) {
      const date = build(Number(m[1]), Number(m[2]), Number(m[3]));
      if (date) return date;
    }
    // 令和8年10月24日・R8.10.24
    m = /(?:令和|R)\s*(\d{1,2}|元)\s*[年.\/]\s*(\d{1,2})\s*[月.\/]\s*(\d{1,2})/.exec(line);
    if (m) {
      const date = build(2018 + (m[1] === '元' ? 1 : Number(m[1])), Number(m[2]), Number(m[3]));
      if (date) return date;
    }
    // 26/10/24（年が2桁）。時刻（10:24）と取り違えないよう区切りは / と . だけ
    m = /(?<!\d)(\d{2})[/.](\d{1,2})[/.](\d{1,2})(?!\d)/.exec(line);
    if (m) {
      const date = build(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
      if (date) return date;
    }
  }
  return undefined;
}

function receiptOdo(lines: string[], kind: DraftCategory): number | undefined {
  const toKm = (s: string) => Number(s.replace(/,/g, ''));
  // 「次回交換 46,200km」のような次の目安は走行距離として使わない
  const usable = lines.filter((l) => !/次回|目安|交換時期|トリップ|TRIP|航続|燃費/i.test(l));
  for (const line of usable) {
    const labeled = /(?:走行距離|ODO|オドメーター|走行)\s*[:：]?\s*(\d{1,3}(?:,\d{3})+|\d{3,7})/i.exec(line);
    if (labeled) return toKm(labeled[1]);
  }
  for (const line of usable) {
    const withUnit = /(\d{1,3}(?:,\d{3})+|\d{3,7})\s*km/i.exec(line);
    if (withUnit) return toKm(withUnit[1]);
  }
  // メーターの写真：時刻・小数（トリップ）・日付・電話番号・金額でない4〜7桁の数が1つだけなら、それを総走行距離とみなす
  if (kind === 'odometer') {
    const candidates = usable
      .filter((l) => !/[円¥￥]|TEL|電話/i.test(l))
      .flatMap((l) => [...l.matchAll(/(?<![\d.:,/\-])(\d{4,7})(?![\d.:,/\-年月])/g)].map((m) => Number(m[1])));
    const unique = [...new Set(candidates)];
    if (unique.length === 1) return unique[0];
  }
  return undefined;
}

/** レシートの給油量（「数量 30.12L」「30.12 ℓ」）と単価（「単価 172」「@172.5」「172円/L」） */
function receiptFuel(lines: string[]): Pick<RecordDraft, 'fuelLiters' | 'fuelUnitPrice'> {
  const result: Pick<RecordDraft, 'fuelLiters' | 'fuelUnitPrice'> = {};
  for (const line of lines) {
    if (result.fuelLiters == null) {
      const m = /(?:数量|給油量)\s*[:：]?\s*(\d{1,4}(?:\.\d{1,2})?)/.exec(line) ?? /(\d{1,4}\.\d{1,2})\s*(?:L|リットル)(?![a-zA-Z])/.exec(line);
      if (m && isValidFuelLiters(Number(m[1]))) result.fuelLiters = Number(m[1]);
    }
    if (result.fuelUnitPrice == null) {
      const m =
        /単価\s*[:：]?\s*[¥￥]?\s*(\d{2,4}(?:\.\d)?)/.exec(line) ??
        /@\s*[¥￥]?\s*(\d{2,4}(?:\.\d)?)/.exec(line) ??
        /(\d{2,4}(?:\.\d)?)\s*円?\s*\/\s*L(?![a-zA-Z])/.exec(line);
      const n = m ? Number(m[1]) : NaN;
      if (n >= MIN_UNIT_PRICE && n <= MAX_UNIT_PRICE) result.fuelUnitPrice = n;
    }
  }
  return result;
}

/**
 * 端末の OCR が返した行から下書きを作る。
 * 決まった書き方（「合計」「2026/10/24」「走行距離」「km」）だけを拾い、迷うものは入れない（足りなければサーバーで読み直す）
 */
export function parseReceiptText(rawLines: string[], kind: DraftCategory, today: IsoDate): RecordDraft {
  const lines = rawLines.map((l) => normalize(l).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const text = lines.join('\n');
  const draft: RecordDraft = {};

  // 合計の行（数字が次の行に分かれていることもある）から金額を拾い、いちばん大きいものを支払額とする
  const totals: number[] = [];
  lines.forEach((line, i) => {
    if (!TOTAL_LINE.test(line) || NOT_TOTAL_LINE.test(line)) return;
    const here = amountsIn(line.replace(TOTAL_LINE, ' '));
    totals.push(...(here.length > 0 ? here : amountsIn(lines[i + 1] ?? '')));
  });
  if (totals.length > 0) draft.amountYen = Math.max(...totals);

  const date = receiptDate(lines, today);
  if (date) draft.date = date;

  const odo = receiptOdo(lines, kind);
  if (odo != null && odo <= MAX_ODO_KM) draft.odo = odo;

  if (/エレメント|フィルター|フィルタ/.test(text)) draft.filterChanged = true;
  if (kind === 'fuel') {
    Object.assign(draft, receiptFuel(lines));
    const fuelType = fuelTypeIn(text);
    if (fuelType) draft.fuelType = fuelType;
  }
  for (const [category, re] of CATEGORY_KEYWORDS) {
    if (re.test(text)) {
      draft.category = category;
      break;
    }
  }
  return draft;
}

/** 端末の読み取りだけで足りるか。足りなければサーバー（AI）で読み直す */
export function isDraftSufficient(kind: DraftCategory, draft: RecordDraft): boolean {
  if (kind === 'odometer' || kind === 'oil_change') return draft.odo != null;
  // 給油は燃費の計算に給油量も要る
  if (kind === 'fuel') return draft.amountYen != null && draft.date != null && draft.fuelLiters != null;
  return draft.amountYen != null && draft.date != null;
}

/** サーバーの結果を優先し、サーバーが読めなかった項目だけ端末の結果で埋める */
export function mergeDrafts(device: RecordDraft, server: RecordDraft): RecordDraft {
  const merged: RecordDraft = { ...device };
  for (const [key, value] of Object.entries(server) as [keyof RecordDraft, RecordDraft[keyof RecordDraft]][]) {
    if (value != null) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}
