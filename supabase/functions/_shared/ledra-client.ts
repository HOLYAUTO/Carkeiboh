/**
 * Ledra の外部API の呼び出し。API キーはサーバー側だけに置く（アプリに埋め込まない）。
 * 【要確認】エンドポイントの形は docs/ledra-api-contract.md の想定。Ledra 側の実装に合わせて直す。
 */
import { requireEnv } from './http.ts';

/** QR のトークンが期限切れ・使用済み・不正 */
export class LedraTokenError extends Error {}
/** 連携が Ledra 側で無効（解除済み・所有者移転など） */
export class LedraLinkInactiveError extends Error {}

export interface LedraConsent {
  version: string;
  recipient: string;
  items: readonly string[];
  agreed_at: string;
  /** 利用者を特定しない、連携ごとの参照ID（カーケイボー側の ledra_links.id） */
  consumer_link_ref: string;
}

export interface LedraClient {
  confirmLink(token: string, consent: LedraConsent): Promise<{ linkId: string; shopName: string | null }>;
  fetchOilRecords(linkId: string, cursor: string | null): Promise<{ records: unknown[]; nextCursor: string | null; hasMore: boolean }>;
  revokeLink(linkId: string): Promise<void>;
}

const TIMEOUT_MS = 15_000;

export function ledraClientFromEnv(): LedraClient {
  const base = requireEnv('LEDRA_API_BASE_URL').replace(/\/+$/, '');
  const key = requireEnv('LEDRA_API_KEY');

  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  const fail = async (res: Response, what: string) => {
    const text = await res.text().catch(() => '');
    return new Error(`Ledra ${what} が失敗しました（HTTP ${res.status}）${text.slice(0, 200)}`);
  };

  return {
    async confirmLink(token, consent) {
      const res = await call('/v1/consumer-links', { method: 'POST', body: JSON.stringify({ token, consent }) });
      if ([400, 404, 409, 410].includes(res.status)) throw new LedraTokenError(`HTTP ${res.status}`);
      if (!res.ok) throw await fail(res, '連携の確定');
      const body = await res.json();
      if (typeof body?.link_id !== 'string') throw new Error('Ledra の応答に link_id がありません');
      return { linkId: body.link_id, shopName: typeof body.shop_name === 'string' ? body.shop_name : null };
    },

    async fetchOilRecords(linkId, cursor) {
      const q = cursor ? `?since=${encodeURIComponent(cursor)}` : '';
      const res = await call(`/v1/consumer-links/${encodeURIComponent(linkId)}/oil-records${q}`);
      if ([403, 404, 410].includes(res.status)) throw new LedraLinkInactiveError(`HTTP ${res.status}`);
      if (!res.ok) throw await fail(res, '記録の取得');
      const body = await res.json();
      return {
        records: Array.isArray(body?.records) ? body.records : [],
        nextCursor: typeof body?.next_cursor === 'string' ? body.next_cursor : cursor,
        hasMore: body?.has_more === true,
      };
    },

    async revokeLink(linkId) {
      const res = await call(`/v1/consumer-links/${encodeURIComponent(linkId)}`, { method: 'DELETE' });
      // すでに無効なら解除できたものとみなす
      if (res.ok || [404, 410].includes(res.status)) return;
      throw await fail(res, '連携の解除');
    },
  };
}
