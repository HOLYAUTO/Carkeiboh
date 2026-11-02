/**
 * App Store / Google Play から受け取った購入の情報を、イジログの購入の記録（billing_purchases）の形にそろえる。
 * ストアの API を呼ぶ部分（billing-apple.ts / billing-google.ts）とは分けて、ここは計算だけにする（tests/domain で試験する）。
 */
import { BILLING_PRODUCTS, billingKindOf, type BillingKind } from './domain/billing.ts';

export interface StorePurchase {
  platform: 'ios' | 'android';
  kind: BillingKind;
  productId: string;
  /** iOS：定期購入は originalTransactionId、事務手数料は transactionId。Android：purchaseToken */
  storeRef: string;
  environment: 'production' | 'sandbox';
  /** 定期購入：この日時まで使える（猶予期間を含む）。使えない状態なら null。事務手数料は null */
  entitledUntil: string | null;
  autoRenew: boolean | null;
  /** 返金・取り消しされた日時 */
  revokedAt: string | null;
  /** 購入のときにアプリが付けた、イジログの利用者ID（iOS の appAccountToken、Android の obfuscatedAccountId）。無ければ null */
  accountToken: string | null;
  /** 購入として成り立っているか（支払いが保留中の1回限りの購入などは false） */
  completed: boolean;
  /** Google Play：3日以内に確認（acknowledge）しないと自動で返金される */
  needsAcknowledge: boolean;
}

const iso = (ms: number | string | null | undefined) => {
  if (ms === null || ms === undefined || ms === '') return null;
  const t = typeof ms === 'number' ? ms : Number.isFinite(Number(ms)) ? Number(ms) : Date.parse(ms);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const later = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : Date.parse(a) >= Date.parse(b) ? a : b);

// ---------------------------------------------------------------------------
// App Store（App Store Server API の JWSTransactionDecodedPayload など）
// ---------------------------------------------------------------------------

export interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  /** ミリ秒 */
  expiresDate?: number;
  revocationDate?: number;
  appAccountToken?: string;
  environment: 'Production' | 'Sandbox' | string;
}

export interface AppleRenewalInfo {
  autoRenewStatus?: 0 | 1;
  gracePeriodExpiresDate?: number;
}

/** Get All Subscription Statuses の status。1：有効、2：期限切れ、3：支払いの再試行中、4：猶予期間、5：取り消し */
export type AppleSubscriptionStatus = 1 | 2 | 3 | 4 | 5;

const appleEnv = (tx: AppleTransaction) => (tx.environment === 'Production' ? 'production' : 'sandbox');

export function fromAppleSubscription(status: AppleSubscriptionStatus, tx: AppleTransaction, renewal: AppleRenewalInfo | null): StorePurchase {
  const expires = iso(tx.expiresDate);
  let entitledUntil: string | null = null;
  if (status === 1) entitledUntil = expires;
  else if (status === 4) entitledUntil = later(expires, iso(renewal?.gracePeriodExpiresDate));
  const revokedAt = iso(tx.revocationDate) ?? (status === 5 ? new Date().toISOString() : null);
  return {
    platform: 'ios',
    kind: 'subscription',
    productId: tx.productId,
    storeRef: tx.originalTransactionId,
    environment: appleEnv(tx),
    entitledUntil: revokedAt ? null : entitledUntil,
    autoRenew: renewal?.autoRenewStatus === undefined ? null : renewal.autoRenewStatus === 1,
    revokedAt,
    accountToken: tx.appAccountToken ?? null,
    completed: true,
    needsAcknowledge: false,
  };
}

export function fromAppleTransaction(tx: AppleTransaction): StorePurchase {
  return {
    platform: 'ios',
    kind: 'restore_fee',
    productId: tx.productId,
    storeRef: tx.transactionId,
    environment: appleEnv(tx),
    entitledUntil: null,
    autoRenew: null,
    revokedAt: iso(tx.revocationDate),
    accountToken: tx.appAccountToken ?? null,
    completed: true,
    needsAcknowledge: false,
  };
}

// ---------------------------------------------------------------------------
// Google Play（Google Play Developer API の SubscriptionPurchaseV2 / ProductPurchase）
// ---------------------------------------------------------------------------

export interface GoogleSubscriptionV2 {
  subscriptionState?: string;
  acknowledgementState?: string;
  testPurchase?: Record<string, unknown>;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: { productId?: string; expiryTime?: string; autoRenewingPlan?: { autoRenewEnabled?: boolean } }[];
}

/** 使える状態。CANCELED は自動更新を止めただけで、期限までは使える */
const GOOGLE_ENTITLED_STATES = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED']);

export function fromGoogleSubscription(purchaseToken: string, sub: GoogleSubscriptionV2): StorePurchase {
  const items = sub.lineItems ?? [];
  const item = items.find((i) => i.productId === BILLING_PRODUCTS.plusMonthly) ?? items[0];
  const expiry = iso(item?.expiryTime);
  const state = sub.subscriptionState ?? '';
  return {
    platform: 'android',
    kind: 'subscription',
    productId: item?.productId ?? '',
    storeRef: purchaseToken,
    environment: sub.testPurchase ? 'sandbox' : 'production',
    entitledUntil: GOOGLE_ENTITLED_STATES.has(state) ? expiry : null,
    autoRenew: item?.autoRenewingPlan?.autoRenewEnabled ?? null,
    revokedAt: null,
    accountToken: sub.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    completed: state !== 'SUBSCRIPTION_STATE_PENDING' && state !== 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED',
    needsAcknowledge: sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING',
  };
}

export interface GoogleProductPurchase {
  /** 0：購入済み、1：取り消し、2：保留中 */
  purchaseState?: number;
  /** 0：未確認、1：確認済み */
  acknowledgementState?: number;
  /** 0：テスト用の購入 */
  purchaseType?: number;
  obfuscatedExternalAccountId?: string;
}

export function fromGoogleProduct(purchaseToken: string, productId: string, p: GoogleProductPurchase): StorePurchase {
  return {
    platform: 'android',
    kind: 'restore_fee',
    productId,
    storeRef: purchaseToken,
    environment: p.purchaseType === 0 ? 'sandbox' : 'production',
    entitledUntil: null,
    autoRenew: null,
    revokedAt: p.purchaseState === 1 ? new Date().toISOString() : null,
    accountToken: p.obfuscatedExternalAccountId ?? null,
    completed: p.purchaseState === 0,
    needsAcknowledge: p.purchaseState === 0 && p.acknowledgementState === 0,
  };
}

/** 商品IDが、記録しようとしている種類（定期購入／事務手数料）と合っているか */
export function matchesKind(p: StorePurchase): boolean {
  return billingKindOf(p.productId) === p.kind;
}

/** 購入に付いた利用者IDが、この利用者のものか。付いていない購入（ストアの画面から買ったものなど）は、最初に確かめた利用者のものにする */
export function accountMatches(p: StorePurchase, userId: string): boolean {
  return p.accountToken === null || p.accountToken.toLowerCase() === userId.toLowerCase();
}
