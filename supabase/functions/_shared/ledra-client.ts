/**
 * Ledra の外部API の呼び出し。API キーはサーバー側だけに置く（アプリに埋め込まない）。
 * エンドポイントの形は docs/ledra-api-contract.md（2026-10-23 確定：Ledra 側がこの形に合わせる）。
 */
import { requireEnv } from './http.ts';

/** QR のトークンが期限切れ・使用済み・不正 */
export class LedraTokenError extends Error {}
/** 連携が Ledra 側で無効（解除済み・所有者移転など） */
export class LedraLinkInactiveError extends Error {}
/** この車両は Ledra 側で、すでにカーケイボーと連携している（別のアカウントの連携が残っているなど） */
export class LedraAlreadyLinkedError extends Error {}

export interface LedraConsent {
  version: string;
  recipient: string;
  items: readonly string[];
  agreed_at: string;
  /** 利用者を特定しない、連携ごとの参照ID（カーケイボー側の ledra_links.id） */
  consumer_link_ref: string;
  /** 同意画面に提供元として表示した店舗名 */
  provider_shop_name: string;
}

export interface LedraTokenPreview {
  shopName: string;
  expiresAt: string | null;
}

export interface LedraClient {
  /** 同意の前に、QR を表示した店舗名を確かめる（トークンは消費しない） */
  previewToken(token: string): Promise<LedraTokenPreview>;
  confirmLink(token: string, consent: LedraConsent): Promise<{ linkId: string; shopName: string | null }>;
  fetchOilRecords(linkId: string, cursor: string | null): Promise<{ records: unknown[]; nextCursor: string | null; hasMore: boolean }>;
  revokeLink(linkId: string): Promise<void>;
  /** 廃車にしたことを伝える（以後 Ledra 側でも、その車両の連携・記録を受け付けない）。解除済みの連携でも送れる */
  reportScrapped(linkId: string, scrappedOn: string): Promise<void>;
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
    async previewToken(token) {
      const res = await call(`/v1/consumer-link-tokens/${encodeURIComponent(token)}`);
      if ([400, 404, 410].includes(res.status)) throw new LedraTokenError(`HTTP ${res.status}`);
      if (!res.ok) throw await fail(res, 'トークンの照会');
      const body = await res.json();
      if (typeof body?.shop_name !== 'string' || !body.shop_name.trim()) {
        throw new Error('Ledra の応答に shop_name がありません');
      }
      return {
        shopName: body.shop_name.trim().slice(0, 100),
        expiresAt: typeof body.expires_at === 'string' ? body.expires_at : null,
      };
    },

    async confirmLink(token, consent) {
      const res = await call('/v1/consumer-links', { method: 'POST', body: JSON.stringify({ token, consent }) });
      if (res.status === 409) throw new LedraAlreadyLinkedError(`HTTP ${res.status}`);
      if ([400, 404, 410].includes(res.status)) throw new LedraTokenError(`HTTP ${res.status}`);
      if (!res.ok) throw await fail(res, '連携の確定');
      const body = await res.json();
      if (typeof body?.link_id !== 'string') throw new Error('Ledra の応答に link_id がありません');
      return { linkId: body.link_id, shopName: typeof body.shop_name === 'string' ? body.shop_name : null };
    },

    async fetchOilRecords(linkId, cursor) {
      const q = cursor ? `?since=${encodeURIComponent(cursor)}` : '';
      const res = await call(`/v1/consumer-links/${encodeURIComponent(linkId)}/oil-records${q}`);
      // 403 は「鍵のスコープ不足」で設定ミス。連携を切らずにエラーとして残す
      if ([404, 410].includes(res.status)) throw new LedraLinkInactiveError(`HTTP ${res.status}`);
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

    async reportScrapped(linkId, scrappedOn) {
      const res = await call(`/v1/consumer-links/${encodeURIComponent(linkId)}/vehicle-status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'scrapped', effective_on: scrappedOn }),
      });
      // 404 は「Ledra 側がまだこの API に対応していない」場合もあるため、届いたとはみなさず再送する
      if (res.ok) return;
      throw await fail(res, '廃車の通知');
    },
  };
}
