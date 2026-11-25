/**
 * App Store Server API の呼び出し（購入の状態をアップルに直接たずねる）。
 * アプリから送られた値は信用せず、取引IDだけを受け取って、ここで状態を取り直す。
 * 応答の JWS はアップルから TLS で受け取ったものなので、中身をそのまま読む。
 * 鍵：App Store Connect の「ユーザとアクセス → 統合 → アプリ内課金」で作る（docs/setup.md）
 */
import { BILLING_PRODUCTS } from './domain/billing.ts';
import { requireEnv } from './http.ts';
import { decodeJwsPayload, signEs256 } from './jwt.ts';
import type { AppleRenewalInfo, AppleSubscriptionStatus, AppleTransaction } from './billing-stores.ts';

export interface AppleSubscriptionState {
  status: AppleSubscriptionStatus;
  transaction: AppleTransaction;
  renewal: AppleRenewalInfo | null;
}

export interface AppleClient {
  readonly bundleId: string;
  /** 複数台プランの状態。取引IDは、その定期購入のどの取引のものでもよい。見つからなければ null */
  subscription(transactionId: string): Promise<AppleSubscriptionState | null>;
  /** 1回限りの購入（事務手数料）の取引。見つからなければ null */
  transaction(transactionId: string): Promise<AppleTransaction | null>;
}

const HOSTS = {
  production: 'https://api.storekit.itunes.apple.com',
  sandbox: 'https://api.storekit-sandbox.itunes.apple.com',
} as const;

const TIMEOUT_MS = 15_000;

export function appleClientFromEnv(): AppleClient {
  const bundleId = requireEnv('APPLE_BUNDLE_ID');
  const issuerId = requireEnv('APPLE_IAP_ISSUER_ID');
  const keyId = requireEnv('APPLE_IAP_KEY_ID');
  const privateKey = requireEnv('APPLE_IAP_PRIVATE_KEY');

  let token: { value: string; expiresAt: number } | null = null;
  const bearer = async () => {
    const now = Math.floor(Date.now() / 1000);
    if (!token || token.expiresAt - 60 < now) {
      const exp = now + 20 * 60;
      token = {
        value: await signEs256({ kid: keyId }, { iss: issuerId, iat: now, exp, aud: 'appstoreconnect-v1', bid: bundleId }, privateKey),
        expiresAt: exp,
      };
    }
    return token.value;
  };

  /**
   * 本番で見つからなければサンドボックス（TestFlight・ad hoc・審査の購入）をたずねる。
   * 公開前のアプリには、本番は鍵が正しくても 401 を返す（2026-11-25 に確認。docs/error-codes.md の IJ-BIL-006）ので、
   * 本番の 401 もサンドボックスへ進む。鍵が本当に間違っていれば、サンドボックスも 401 になって失敗する
   */
  const get = async <T>(path: string): Promise<T | null> => {
    for (const host of [HOSTS.production, HOSTS.sandbox]) {
      const res = await fetch(`${host}${path}`, {
        headers: { authorization: `Bearer ${await bearer()}`, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 404 || (res.status === 401 && host === HOSTS.production)) continue;
      const text = await res.text().catch(() => '');
      throw new Error(`App Store Server API が失敗しました（HTTP ${res.status}）${text.slice(0, 200)}`);
    }
    return null;
  };

  return {
    bundleId,
    async subscription(transactionId) {
      const body = await get<{
        data?: { lastTransactions?: { status: AppleSubscriptionStatus; signedTransactionInfo: string; signedRenewalInfo?: string }[] }[];
      }>(`/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`);
      if (!body) return null;
      for (const group of body.data ?? []) {
        for (const last of group.lastTransactions ?? []) {
          const transaction = decodeJwsPayload<AppleTransaction>(last.signedTransactionInfo);
          if (transaction.productId !== BILLING_PRODUCTS.plusMonthly) continue;
          const renewal = last.signedRenewalInfo ? decodeJwsPayload<AppleRenewalInfo>(last.signedRenewalInfo) : null;
          return { status: last.status, transaction, renewal };
        }
      }
      return null;
    },
    async transaction(transactionId) {
      const body = await get<{ signedTransactionInfo?: string }>(`/inApps/v1/transactions/${encodeURIComponent(transactionId)}`);
      return body?.signedTransactionInfo ? decodeJwsPayload<AppleTransaction>(body.signedTransactionInfo) : null;
    },
  };
}
