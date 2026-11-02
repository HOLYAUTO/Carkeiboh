import { describe, expect, it } from 'vitest';
import {
  accountMatches,
  fromAppleSubscription,
  fromAppleTransaction,
  fromGoogleProduct,
  fromGoogleSubscription,
  matchesKind,
  type AppleTransaction,
} from '../../supabase/functions/_shared/billing-stores.ts';
import { BILLING_PRODUCTS, billingKindOf, restoreFreeDaysLeft } from '../../supabase/functions/_shared/domain/billing.ts';

const user = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

const appleTx = (over: Partial<AppleTransaction> = {}): AppleTransaction => ({
  transactionId: '2000000001',
  originalTransactionId: '2000000000',
  bundleId: 'app.ijilog',
  productId: BILLING_PRODUCTS.plusMonthly,
  expiresDate: Date.parse('2026-12-01T00:00:00Z'),
  appAccountToken: user,
  environment: 'Production',
  ...over,
});

describe('商品ID', () => {
  it('定期購入と事務手数料を見分け、ほかの商品は扱わない', () => {
    expect(billingKindOf(BILLING_PRODUCTS.plusMonthly)).toBe('subscription');
    expect(billingKindOf(BILLING_PRODUCTS.restoreFee)).toBe('restore_fee');
    expect(billingKindOf('other')).toBeNull();
  });

  it('事務手数料なしで戻せる残りの日数は切り上げ、期限を過ぎれば0', () => {
    const now = new Date('2026-11-02T00:00:00Z');
    expect(restoreFreeDaysLeft('2026-11-03T00:00:00Z', now)).toBe(1);
    expect(restoreFreeDaysLeft('2026-11-02T00:00:01Z', now)).toBe(1);
    expect(restoreFreeDaysLeft('2026-11-02T00:00:00Z', now)).toBe(0);
    expect(restoreFreeDaysLeft('2026-10-01T00:00:00Z', now)).toBe(0);
  });
});

describe('App Store', () => {
  it('有効な定期購入は、最初の取引IDで記録し、期限まで使える', () => {
    const p = fromAppleSubscription(1, appleTx(), { autoRenewStatus: 1 });
    expect(p).toMatchObject({
      platform: 'ios',
      kind: 'subscription',
      storeRef: '2000000000',
      environment: 'production',
      entitledUntil: '2026-12-01T00:00:00.000Z',
      autoRenew: true,
      revokedAt: null,
      accountToken: user,
    });
    expect(matchesKind(p)).toBe(true);
  });

  it('猶予期間中は、猶予の終わりまで使える', () => {
    const p = fromAppleSubscription(4, appleTx(), { autoRenewStatus: 1, gracePeriodExpiresDate: Date.parse('2026-12-17T00:00:00Z') });
    expect(p.entitledUntil).toBe('2026-12-17T00:00:00.000Z');
  });

  it('期限切れ・支払いの再試行中は使えない。サンドボックスの購入も見分ける', () => {
    expect(fromAppleSubscription(2, appleTx(), { autoRenewStatus: 0 }).entitledUntil).toBeNull();
    const retry = fromAppleSubscription(3, appleTx({ environment: 'Sandbox' }), { autoRenewStatus: 1 });
    expect(retry.entitledUntil).toBeNull();
    expect(retry.environment).toBe('sandbox');
  });

  it('返金された定期購入は取り消しとして扱い、使えない', () => {
    const p = fromAppleSubscription(5, appleTx({ revocationDate: Date.parse('2026-11-10T00:00:00Z') }), null);
    expect(p.revokedAt).toBe('2026-11-10T00:00:00.000Z');
    expect(p.entitledUntil).toBeNull();
    expect(p.autoRenew).toBeNull();
  });

  it('事務手数料は取引IDで記録する', () => {
    const p = fromAppleTransaction(appleTx({ productId: BILLING_PRODUCTS.restoreFee, expiresDate: undefined }));
    expect(p).toMatchObject({ kind: 'restore_fee', storeRef: '2000000001', entitledUntil: null, revokedAt: null, completed: true });
    expect(matchesKind(p)).toBe(true);
  });

  it('定期購入の商品IDでない取引は、定期購入として受け付けない', () => {
    expect(matchesKind(fromAppleSubscription(1, appleTx({ productId: BILLING_PRODUCTS.restoreFee }), null))).toBe(false);
  });
});

describe('Google Play', () => {
  const sub = (state: string, over: Record<string, unknown> = {}) => ({
    subscriptionState: state,
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
    externalAccountIdentifiers: { obfuscatedExternalAccountId: user },
    lineItems: [{ productId: BILLING_PRODUCTS.plusMonthly, expiryTime: '2026-12-01T00:00:00Z', autoRenewingPlan: { autoRenewEnabled: true } }],
    ...over,
  });

  it('有効・猶予期間・自動更新を止めただけの定期購入は、期限まで使える', () => {
    for (const state of ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED']) {
      const p = fromGoogleSubscription('tok', sub(state));
      expect(p.entitledUntil).toBe('2026-12-01T00:00:00.000Z');
    }
    const p = fromGoogleSubscription('tok', sub('SUBSCRIPTION_STATE_ACTIVE'));
    expect(p).toMatchObject({ platform: 'android', storeRef: 'tok', autoRenew: true, accountToken: user, needsAcknowledge: true, completed: true });
  });

  it('保留・一時停止・期限切れは使えない。支払いが保留中の購入はまだ成り立っていない', () => {
    for (const state of ['SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PAUSED', 'SUBSCRIPTION_STATE_EXPIRED']) {
      expect(fromGoogleSubscription('tok', sub(state)).entitledUntil).toBeNull();
    }
    expect(fromGoogleSubscription('tok', sub('SUBSCRIPTION_STATE_PENDING')).completed).toBe(false);
  });

  it('テスト用の購入はサンドボックスとして記録する。確認済みなら確認し直さない', () => {
    const p = fromGoogleSubscription('tok', sub('SUBSCRIPTION_STATE_ACTIVE', { testPurchase: {}, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' }));
    expect(p.environment).toBe('sandbox');
    expect(p.needsAcknowledge).toBe(false);
  });

  it('事務手数料は、購入済みのときだけ成り立つ。取り消されたものは取り消しとして扱う', () => {
    const ok = fromGoogleProduct('tok2', BILLING_PRODUCTS.restoreFee, { purchaseState: 0, acknowledgementState: 0, obfuscatedExternalAccountId: user });
    expect(ok).toMatchObject({ kind: 'restore_fee', completed: true, needsAcknowledge: true, revokedAt: null, environment: 'production' });
    const pending = fromGoogleProduct('tok2', BILLING_PRODUCTS.restoreFee, { purchaseState: 2, acknowledgementState: 0 });
    expect(pending).toMatchObject({ completed: false, needsAcknowledge: false });
    expect(fromGoogleProduct('tok2', BILLING_PRODUCTS.restoreFee, { purchaseState: 1 }).revokedAt).not.toBeNull();
  });
});

describe('購入とアカウントの結びつき', () => {
  const p = fromAppleSubscription(1, appleTx(), null);

  it('購入のときに付けた利用者IDと同じ利用者だけが使える（大文字・小文字は区別しない）', () => {
    expect(accountMatches(p, user)).toBe(true);
    expect(accountMatches(p, user.toUpperCase())).toBe(true);
    expect(accountMatches(p, 'aaaaaaaa-0000-4000-8000-000000000000')).toBe(false);
  });

  it('利用者IDの付いていない購入は、だれのものとしても受け付ける（同じ購入を2人目は使えない。DB の一意制約で止める）', () => {
    expect(accountMatches(fromAppleSubscription(1, appleTx({ appAccountToken: undefined }), null), user)).toBe(true);
  });
});
