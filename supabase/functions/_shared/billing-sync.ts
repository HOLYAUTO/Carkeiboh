/**
 * 購入の確認と記録。billing-verify（アプリから）・billing-notify（ストアからの通知）・billing-reconcile（定期実行）で使う。
 * どの入口でも、ストアの API で状態を取り直してから記録する（受け取った値をそのまま信用しない）。
 */
import { appleClientFromEnv, type AppleClient } from './billing-apple.ts';
import { googleClientFromEnv, type GoogleClient } from './billing-google.ts';
import {
  accountMatches,
  fromAppleSubscription,
  fromAppleTransaction,
  fromGoogleProduct,
  fromGoogleSubscription,
  matchesKind,
  type StorePurchase,
} from './billing-stores.ts';
import { BILLING_PRODUCTS, type BillingKind } from './domain/billing.ts';
import { HttpError } from './http.ts';
import type { SupabaseClient } from './supabase.ts';

export type Platform = 'ios' | 'android';

/** ストアの API の呼び出し。鍵の無いほうのストアの購入が来たときだけ失敗するよう、使うときに作る */
export class StoreClients {
  #apple: AppleClient | null = null;
  #google: GoogleClient | null = null;
  get apple() {
    return (this.#apple ??= appleClientFromEnv());
  }
  get google() {
    return (this.#google ??= googleClientFromEnv());
  }
}

/** ストアに購入の状態をたずねる。ref は iOS なら取引ID、Android なら購入トークン。見つからなければ null */
export async function fetchStorePurchase(stores: StoreClients, platform: Platform, kind: BillingKind, ref: string): Promise<StorePurchase | null> {
  if (platform === 'ios') {
    const apple = stores.apple;
    if (kind === 'subscription') {
      const state = await apple.subscription(ref);
      if (!state || state.transaction.bundleId !== apple.bundleId) return null;
      return fromAppleSubscription(state.status, state.transaction, state.renewal);
    }
    const tx = await apple.transaction(ref);
    if (!tx || tx.bundleId !== apple.bundleId) return null;
    return fromAppleTransaction(tx);
  }
  const google = stores.google;
  if (kind === 'subscription') {
    const sub = await google.subscription(ref);
    return sub ? fromGoogleSubscription(ref, sub) : null;
  }
  const product = await google.product(BILLING_PRODUCTS.restoreFee, ref);
  return product ? fromGoogleProduct(ref, BILLING_PRODUCTS.restoreFee, product) : null;
}

export type SaveResult = 'saved' | 'pending';

/**
 * 購入をこの利用者のものとして記録し、休止中のクルマで戻せるものを戻す。
 * 別のアカウントが使っている購入・別の利用者IDが付いた購入は受け付けない
 */
export async function savePurchase(admin: SupabaseClient, p: StorePurchase, userId: string): Promise<SaveResult> {
  if (!matchesKind(p)) throw new HttpError(400, 'unknown_product', 'この商品は取り扱っていません。');
  if (!accountMatches(p, userId)) {
    throw new HttpError(403, 'account_mismatch', 'この購入は別のアカウントで行われています。購入したアカウントでログインしてください。');
  }

  const { data: existing, error: findError } = await admin
    .from('billing_purchases')
    .select('user_id, revoked_at')
    .eq('platform', p.platform)
    .eq('store_ref', p.storeRef)
    .maybeSingle();
  if (findError) throw findError;
  if (existing && existing.user_id !== userId) {
    throw new HttpError(409, 'purchase_owned_by_other', 'この購入は、すでに別のアカウントで使われています。');
  }
  // 支払いが済んでいない（保留中の）購入は、済んでから記録する
  if (!p.completed && !existing) return 'pending';

  const { error } = await admin.from('billing_purchases').upsert(
    {
      user_id: userId,
      platform: p.platform,
      kind: p.kind,
      product_id: p.productId,
      store_ref: p.storeRef,
      environment: p.environment,
      entitled_until: p.kind === 'subscription' ? p.entitledUntil : null,
      auto_renew: p.autoRenew,
      // 一度取り消された購入は、取り消しの日時を変えない
      revoked_at: existing?.revoked_at ?? p.revokedAt,
      last_verified_at: new Date().toISOString(),
    },
    { onConflict: 'platform,store_ref' },
  );
  if (error) throw error;

  const { error: restoreError } = await admin.rpc('apply_plan_restore', { p_user_id: userId });
  if (restoreError) throw restoreError;
  return 'saved';
}

/** Google Play の購入は、記録した後に確認（acknowledge）する。3日以内に確認しないと自動で返金される */
export async function acknowledgeIfNeeded(stores: StoreClients, p: StorePurchase) {
  if (p.platform !== 'android' || !p.needsAcknowledge) return;
  if (p.kind === 'subscription') await stores.google.acknowledgeSubscription(p.productId, p.storeRef);
  else await stores.google.acknowledgeProduct(p.productId, p.storeRef);
}

export interface StoredPurchase {
  user_id: string;
  platform: Platform;
  kind: BillingKind;
  store_ref: string;
}

/** 記録済みの購入の状態をストアで取り直す。ストアで見つからなくなった定期購入は、使えないものとして扱う */
export async function refreshStoredPurchase(admin: SupabaseClient, stores: StoreClients, row: StoredPurchase) {
  const p = await fetchStorePurchase(stores, row.platform, row.kind, row.store_ref);
  if (!p) {
    if (row.kind === 'subscription') {
      await admin
        .from('billing_purchases')
        .update({ entitled_until: null, last_verified_at: new Date().toISOString() })
        .eq('platform', row.platform)
        .eq('store_ref', row.store_ref);
    }
    return;
  }
  await savePurchase(admin, p, row.user_id);
  await acknowledgeIfNeeded(stores, p);
}

/** 返金・取り消しの通知（Google Play の voidedPurchaseNotification） */
export async function revokeStoredPurchase(admin: SupabaseClient, platform: Platform, storeRef: string) {
  const { error } = await admin
    .from('billing_purchases')
    .update({ revoked_at: new Date().toISOString() })
    .eq('platform', platform)
    .eq('store_ref', storeRef)
    .is('revoked_at', null);
  if (error) throw error;
}

export async function findStoredPurchase(admin: SupabaseClient, platform: Platform, storeRef: string): Promise<StoredPurchase | null> {
  const { data, error } = await admin
    .from('billing_purchases')
    .select('user_id, platform, kind, store_ref')
    .eq('platform', platform)
    .eq('store_ref', storeRef)
    .maybeSingle();
  if (error) throw error;
  return (data as StoredPurchase | null) ?? null;
}

/** まだ記録の無い購入の通知が来たとき、購入に付いた利用者IDの利用者がいれば、その人のものとして記録する */
export async function saveForAccountToken(admin: SupabaseClient, stores: StoreClients, p: StorePurchase) {
  const userId = p.accountToken;
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return;
  const { data } = await admin.from('profiles').select('id').eq('id', userId.toLowerCase()).maybeSingle();
  if (!data) return;
  if ((await savePurchase(admin, p, data.id)) === 'saved') await acknowledgeIfNeeded(stores, p);
}
