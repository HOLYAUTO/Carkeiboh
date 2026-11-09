/**
 * Ledra の外部API（別紙02で Ledra 側に追加）の応答を、イジログの記録に変換する。
 * API の形は docs/ledra-api-contract.md（2026-10-23 確定：Ledra 側がこの形に合わせる）。
 */
import { isIsoDate } from './domain/dates.ts';

/** 受け取る項目はこれだけ（日付、ODO、オイル交換・フィルター交換の有無、店舗名）と、取消の印 */
export interface LedraOilRecord {
  record_id: string;
  work_date: string;
  odo_km: number | null;
  oil_changed: boolean;
  filter_changed: boolean;
  shop_name: string | null;
  /** 整備工場が証明書を取り消した。こちらの記録も消す */
  voided: boolean;
}

/** 取り消された記録なら、その記録IDを返す */
export function voidedRecordId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return r.voided === true && typeof r.record_id === 'string' && r.record_id.trim() ? r.record_id.trim().slice(0, 200) : null;
}

export interface OilChangeInsert {
  vehicle_id: string;
  user_id: string;
  performed_on: string;
  odo_km: number;
  oil_changed: boolean;
  filter_changed: boolean;
  source: 'ledra';
  ledra_link_id: string;
  ledra_record_id: string;
  shop_name: string | null;
}

/** 想定外の項目が来ても取り込まない（受け取る項目を絞る）。不正な記録・取り消された記録・ODO の無い記録は null */
export function toOilChangeInsert(
  raw: unknown,
  link: { id: string; vehicle_id: string; user_id: string },
): OilChangeInsert | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.voided === true) return null;
  const recordId = typeof r.record_id === 'string' ? r.record_id.trim() : '';
  const workDate = typeof r.work_date === 'string' ? r.work_date.slice(0, 10) : '';
  const odo = typeof r.odo_km === 'number' ? Math.round(r.odo_km) : NaN;
  const oil = r.oil_changed === true;
  const filter = r.filter_changed === true;
  if (!recordId || !isIsoDate(workDate) || !Number.isFinite(odo) || odo < 0 || odo > 2_000_000) return null;
  if (!oil && !filter) return null;
  const shop = typeof r.shop_name === 'string' && r.shop_name.trim() ? r.shop_name.trim().slice(0, 100) : null;
  return {
    vehicle_id: link.vehicle_id,
    user_id: link.user_id,
    performed_on: workDate,
    odo_km: odo,
    oil_changed: oil,
    filter_changed: filter,
    source: 'ledra',
    ledra_link_id: link.id,
    ledra_record_id: recordId.slice(0, 200),
    shop_name: shop,
  };
}

export interface WearCheckInsert {
  vehicle_id: string;
  user_id: string;
  kind: 'tire' | 'brake';
  performed_on: string;
  odo_km: number | null;
  replaced: boolean;
  remaining_mm: number | null;
  source: 'ledra';
  ledra_link_id: string;
  ledra_record_id: string;
  shop_name: string | null;
}

/**
 * タイヤ・ブレーキの記録（docs/ledra-api-contract.md 5章）。想定外の項目は取り込まない。
 * 不正な記録・取り消された記録は null。残り mm が範囲外なら mm だけ捨てる（記録は残す）
 */
export function toWearCheckInsert(
  raw: unknown,
  link: { id: string; vehicle_id: string; user_id: string },
): WearCheckInsert | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.voided === true) return null;
  const recordId = typeof r.record_id === 'string' ? r.record_id.trim() : '';
  const kind = r.kind === 'tire' || r.kind === 'brake' ? r.kind : null;
  const workDate = typeof r.work_date === 'string' ? r.work_date.slice(0, 10) : '';
  if (!recordId || !kind || !isIsoDate(workDate)) return null;
  const odo = typeof r.odo_km === 'number' && Number.isFinite(r.odo_km) ? Math.round(r.odo_km) : null;
  const mm = typeof r.remaining_mm === 'number' && r.remaining_mm >= 0 && r.remaining_mm <= 30 ? Math.round((r.remaining_mm + Number.EPSILON) * 10) / 10 : null;
  const shop = typeof r.shop_name === 'string' && r.shop_name.trim() ? r.shop_name.trim().slice(0, 100) : null;
  return {
    vehicle_id: link.vehicle_id,
    user_id: link.user_id,
    kind,
    performed_on: workDate,
    odo_km: odo != null && odo >= 0 && odo <= 2_000_000 ? odo : null,
    replaced: r.replaced === true,
    remaining_mm: mm,
    source: 'ledra',
    ledra_link_id: link.id,
    ledra_record_id: recordId.slice(0, 200),
    shop_name: shop,
  };
}

/** 整備・車検・オイル交換の金額（docs/ledra-api-contract.md 6章） */
export interface ServiceRecord {
  recordId: string;
  kind: 'shaken' | 'maintenance' | 'oil_change';
  workDate: string;
  odoKm: number | null;
  title: string | null;
  totalYen: number;
  statutoryFeesYen: number | null;
  shopName: string | null;
}

/** 想定外の項目は取り込まない。不正な記録・取り消された記録・金額の無い記録は null */
export function toServiceRecord(raw: unknown): ServiceRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.voided === true) return null;
  const recordId = typeof r.record_id === 'string' ? r.record_id.trim().slice(0, 200) : '';
  const kind = r.kind === 'shaken' || r.kind === 'maintenance' || r.kind === 'oil_change' ? r.kind : null;
  const workDate = typeof r.work_date === 'string' ? r.work_date.slice(0, 10) : '';
  const total = typeof r.total_yen === 'number' && Number.isInteger(r.total_yen) ? r.total_yen : NaN;
  if (!recordId || !kind || !isIsoDate(workDate) || !(total >= 1 && total <= 99_999_999)) return null;
  const odo = typeof r.odo_km === 'number' && Number.isFinite(r.odo_km) ? Math.round(r.odo_km) : null;
  const fees = kind === 'shaken' && typeof r.statutory_fees_yen === 'number' && Number.isInteger(r.statutory_fees_yen) ? r.statutory_fees_yen : null;
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  return {
    recordId,
    kind,
    workDate,
    odoKm: odo != null && odo >= 0 && odo <= 2_000_000 ? odo : null,
    title: text(r.title, 60),
    totalYen: total,
    statutoryFeesYen: fees != null && fees >= 0 && fees <= total ? fees : null,
    shopName: text(r.shop_name, 100),
  };
}

export interface ServiceExpenseInsert {
  vehicle_id: string;
  user_id: string;
  category: 'shaken' | 'maintenance' | 'oil_change';
  spent_on: string;
  amount_yen: number;
  odo_km: number | null;
  note: string | null;
  exempt_yen: number | null;
  oil_change_id: string | null;
  source: 'ledra';
  ledra_link_id: string;
  ledra_record_id: string;
}

/**
 * 支出の行にする。オイル交換はそのオイル交換の記録（oilChangeId）に紐づける。
 * オイル交換の記録がまだ無ければ null（次の回に取り込む）
 */
export function toServiceExpenseInsert(
  rec: ServiceRecord,
  link: { id: string; vehicle_id: string; user_id: string },
  oilChangeId: string | null,
): ServiceExpenseInsert | null {
  if (rec.kind === 'oil_change' && !oilChangeId) return null;
  const note = [rec.title, rec.shopName].filter(Boolean).join('・').slice(0, 200) || null;
  return {
    vehicle_id: link.vehicle_id,
    user_id: link.user_id,
    category: rec.kind,
    spent_on: rec.workDate,
    amount_yen: rec.totalYen,
    odo_km: rec.kind === 'oil_change' ? null : rec.odoKm,
    note,
    exempt_yen: rec.statutoryFeesYen,
    oil_change_id: rec.kind === 'oil_change' ? oilChangeId : null,
    source: 'ledra',
    ledra_link_id: link.id,
    ledra_record_id: rec.recordId,
  };
}

/**
 * QR の中身から連携用トークンを取り出す。
 * QR はトークンだけ／?token= 付きの URL のどちらでもよい（docs/ledra-api-contract.md）。
 */
export function extractLinkToken(qrData: string): string | null {
  const text = qrData.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      const token = new URL(text).searchParams.get('token');
      return token && /^[A-Za-z0-9._~-]{16,512}$/.test(token) ? token : null;
    } catch {
      return null;
    }
  }
  return /^[A-Za-z0-9._~-]{16,512}$/.test(text) ? text : null;
}

/** 同意画面に出す内容。同意の記録として控えを残す（文面を変えたら版を上げる） */
export const CONSENT_VERSION = '2026-11-08.1';
export const CONSENT_RECIPIENT = '株式会社たにぐち自動車';
/** 末尾の3つは、Ledra がタイヤ・ブレーキの記録を渡す条件（Ledra 側の WEAR_CONSENT_ITEMS と同じ文字列）。変えるときは両方を変える */
export const CONSENT_ITEMS = [
  '作業日',
  '走行距離（ODO）',
  'オイル交換の有無',
  'オイルフィルター交換の有無',
  '店舗名',
  'タイヤの溝の深さ',
  'ブレーキパッドの厚さ',
  'タイヤ・ブレーキパッドの交換の有無',
  // 2026-11-08 追加。Ledra が整備・車検の内容と金額（6章）を渡す条件。Ledra 側と同じ文字列にする
  '整備・車検の内容と金額',
] as const;

/**
 * 受け付ける同意の版と、その版で同意した項目。新しい版を出したあとも、更新前のアプリから届く1つ前の版は受け付ける
 * （その連携には、その版の項目だけを渡す。2026-10-31.1 の連携には整備・車検の金額は渡らない）
 */
export const ACCEPTED_CONSENTS: Readonly<Record<string, readonly string[]>> = {
  [CONSENT_VERSION]: CONSENT_ITEMS,
  '2026-10-31.1': CONSENT_ITEMS.filter((i) => i !== '整備・車検の内容と金額'),
};

export const TOKEN_INVALID_MESSAGE =
  'QRコードの有効期限（15分）が切れたか、すでに使われています。店舗で新しいQRコードを表示してもらってください。';
