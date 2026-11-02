/**
 * Google Play Developer API の呼び出し（購入の状態をグーグルに直接たずねる）。
 * アプリから送られた値は信用せず、購入トークンだけを受け取って、ここで状態を取り直す。
 * 鍵：EAS Submit と同じサービスアカウントの JSON（Play Console で「財務データの表示」「注文と定期購入の管理」の権限が要る。docs/setup.md）
 */
import { requireEnv } from './http.ts';
import { signRs256 } from './jwt.ts';
import type { GoogleProductPurchase, GoogleSubscriptionV2 } from './billing-stores.ts';

export interface GoogleClient {
  readonly packageName: string;
  /** 見つからない・期限切れで消えた購入トークンなら null */
  subscription(purchaseToken: string): Promise<GoogleSubscriptionV2 | null>;
  acknowledgeSubscription(productId: string, purchaseToken: string): Promise<void>;
  product(productId: string, purchaseToken: string): Promise<GoogleProductPurchase | null>;
  acknowledgeProduct(productId: string, purchaseToken: string): Promise<void>;
}

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const TIMEOUT_MS = 15_000;

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function googleClientFromEnv(): GoogleClient {
  const packageName = requireEnv('GOOGLE_PLAY_PACKAGE_NAME');
  const account = JSON.parse(requireEnv('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')) as ServiceAccount;
  const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token';

  let token: { value: string; expiresAt: number } | null = null;
  const bearer = async () => {
    const now = Math.floor(Date.now() / 1000);
    if (!token || token.expiresAt - 60 < now) {
      const assertion = await signRs256(
        {},
        { iss: account.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: tokenUri, iat: now, exp: now + 3600 },
        account.private_key,
      );
      const res = await fetch(tokenUri, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Google の認証に失敗しました（HTTP ${res.status}）`);
      const body = (await res.json()) as { access_token: string; expires_in: number };
      token = { value: body.access_token, expiresAt: now + body.expires_in };
    }
    return token.value;
  };

  const app = `${API}/applications/${encodeURIComponent(packageName)}/purchases`;
  const call = async (url: string, method: 'GET' | 'POST') =>
    fetch(url, {
      method,
      headers: { authorization: `Bearer ${await bearer()}`, accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      body: method === 'POST' ? '{}' : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  const fail = async (res: Response, what: string) => {
    const text = await res.text().catch(() => '');
    return new Error(`Google Play Developer API の${what}が失敗しました（HTTP ${res.status}）${text.slice(0, 200)}`);
  };
  const read = async <T>(url: string, what: string): Promise<T | null> => {
    const res = await call(url, 'GET');
    if (res.ok) return (await res.json()) as T;
    // 400：トークンの形が正しくない、404/410：見つからない・期限切れで消えた
    if (res.status === 400 || res.status === 404 || res.status === 410) return null;
    throw await fail(res, what);
  };
  const acknowledge = async (url: string, what: string) => {
    const res = await call(url, 'POST');
    // すでに確認済みのときは 400 などが返ることがある。状態は呼び出し元が取り直して確かめる
    if (!res.ok && res.status !== 400) throw await fail(res, what);
  };

  return {
    packageName,
    subscription: (purchaseToken) =>
      read<GoogleSubscriptionV2>(`${app}/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, '定期購入の取得'),
    acknowledgeSubscription: (productId, purchaseToken) =>
      acknowledge(
        `${app}/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
        '定期購入の確認',
      ),
    product: (productId, purchaseToken) =>
      read<GoogleProductPurchase>(`${app}/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`, '購入の取得'),
    acknowledgeProduct: (productId, purchaseToken) =>
      acknowledge(`${app}/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`, '購入の確認'),
  };
}
