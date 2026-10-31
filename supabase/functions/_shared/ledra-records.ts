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
export const CONSENT_VERSION = '2026-10-23.2';
export const CONSENT_RECIPIENT = '株式会社たにぐち自動車';
export const CONSENT_ITEMS = ['作業日', '走行距離（ODO）', 'オイル交換の有無', 'オイルフィルター交換の有無', '店舗名'] as const;

export const TOKEN_INVALID_MESSAGE =
  'QRコードの有効期限（15分）が切れたか、すでに使われています。店舗で新しいQRコードを表示してもらってください。';
