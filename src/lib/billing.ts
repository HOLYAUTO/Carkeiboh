/**
 * 複数台プランのアプリ内課金（App Store / Google Play）。購入はストアで行い、確認はサーバー（billing-verify）が行う。
 * 流れ：購入 → ストアから購入が届く（purchaseUpdatedListener）→ サーバーで確認・記録 → 購入を完了（finishTransaction）。
 * 完了していない購入はアプリを開くたびに届き直すので、確認に失敗しても次に開いたときにやり直せる。
 */
import { BILLING_PRODUCTS } from '@domain/billing.ts';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import {
  deepLinkToSubscriptions,
  ErrorCode,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  restorePurchases as restoreStorePurchases,
  type Product,
  type ProductSubscription,
  type Purchase,
} from 'expo-iap';
import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { useAuth } from './auth';
import { invokeFunction } from './supabase';

export { BILLING_PRODUCTS };

let connecting: Promise<unknown> | null = null;

/** ストアにつなぐ。失敗したら次に呼ばれたときにやり直す */
function ensureConnected() {
  connecting ??= initConnection().catch((e) => {
    connecting = null;
    throw e;
  });
  return connecting;
}

export interface BillingProducts {
  plus: ProductSubscription | null;
  restoreFee: Product | null;
}

/** ストアに登録した商品（料金はストアの表示をそのまま使う） */
export function useBillingProducts() {
  return useQuery({
    queryKey: ['billingProducts'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<BillingProducts> => {
      await ensureConnected();
      // 事務手数料の商品はまだストアに無いことがある（最初の審査では定期購入だけを出す）。その失敗で定期購入まで読めなくならないよう、別々に待つ
      const [subs, items] = await Promise.allSettled([
        fetchProducts({ skus: [BILLING_PRODUCTS.plusMonthly], type: 'subs' }),
        fetchProducts({ skus: [BILLING_PRODUCTS.restoreFee], type: 'in-app' }),
      ]);
      if (subs.status === 'rejected') throw subs.reason;
      return {
        plus: ((subs.value ?? []) as ProductSubscription[]).find((p) => p.id === BILLING_PRODUCTS.plusMonthly) ?? null,
        restoreFee:
          items.status === 'fulfilled'
            ? ((items.value ?? []) as Product[]).find((p) => p.id === BILLING_PRODUCTS.restoreFee) ?? null
            : null,
      };
    },
  });
}

/** 複数台プランを申し込む。結果は useBillingListener に届く */
export async function buyPlus(product: ProductSubscription, userId: string) {
  await ensureConnected();
  const offerToken = product.subscriptionOffers?.find((o) => o.offerTokenAndroid)?.offerTokenAndroid ?? null;
  if (Platform.OS === 'android' && !offerToken) throw new Error('料金プランを読み込めませんでした。時間をおいてお試しください。');
  await requestPurchase({
    type: 'subs',
    request: {
      // 購入にイジログの利用者IDを付け、サーバーで「このアカウントの購入か」を確かめる
      apple: { sku: product.id, appAccountToken: userId },
      google: {
        skus: [product.id],
        obfuscatedAccountId: userId,
        subscriptionOffers: offerToken ? [{ sku: product.id, offerToken }] : null,
      },
    },
  });
}

/** 利用者が購入の画面を閉じた（取り消した）ときのエラーか。このときは何も知らせない */
export function isPurchaseCancelled(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === ErrorCode.UserCancelled;
}

/** ストアから返ってきたエラーの中身（code・message・debugMessage）を1行にする。取り消しでも原因を確かめられるよう、画面に小さく出す */
export function purchaseErrorDetail(e: unknown): string {
  if (typeof e !== 'object' || e === null) return String(e);
  const { code, message, debugMessage, responseCode } = e as {
    code?: unknown;
    message?: unknown;
    debugMessage?: unknown;
    responseCode?: unknown;
  };
  return [code, responseCode, message, debugMessage !== message ? debugMessage : null]
    .filter((v) => v != null && v !== '')
    .map(String)
    .join(' / ');
}

/** 復旧の事務手数料を払う。結果は useBillingListener に届く */
export async function buyRestoreFee(product: Product, userId: string) {
  await ensureConnected();
  await requestPurchase({
    type: 'in-app',
    request: {
      apple: { sku: product.id, appAccountToken: userId },
      google: { skus: [product.id], obfuscatedAccountId: userId },
    },
  });
}

interface VerifyResult {
  status: 'saved' | 'pending';
  entitled: boolean;
}

function storeRefOf(purchase: Purchase): string | null {
  if (Platform.OS === 'ios') return ('transactionId' in purchase ? purchase.transactionId : null) ?? purchase.id;
  return purchase.purchaseToken ?? null;
}

const inFlight = new Set<string>();

/** サーバーで購入を確かめて記録し、済んだら購入を完了にする。確かめられなければ完了にしない（次に開いたときにやり直す） */
async function verifyAndFinish(purchase: Purchase, qc: QueryClient): Promise<VerifyResult | null> {
  const isOurs = purchase.productId === BILLING_PRODUCTS.plusMonthly || purchase.productId === BILLING_PRODUCTS.restoreFee;
  const storeRef = storeRefOf(purchase);
  if (!isOurs || !storeRef || inFlight.has(storeRef)) return null;
  inFlight.add(storeRef);
  try {
    const result = await invokeFunction<VerifyResult>('billing-verify', {
      platform: Platform.OS,
      productId: purchase.productId,
      storeRef,
    });
    if (result.status === 'saved') {
      // 事務手数料は消費型（何度でも買える）。定期購入は消費しない
      await finishTransaction({ purchase, isConsumable: purchase.productId === BILLING_PRODUCTS.restoreFee });
    }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['plan'] }),
      qc.invalidateQueries({ queryKey: ['vehicles'] }),
    ]);
    return result;
  } finally {
    inFlight.delete(storeRef);
  }
}

/**
 * ログイン中はストアからの購入を受け取って確かめる（ルートのレイアウトで1回だけ使う）。
 * 購入の直後だけでなく、前に確かめられなかった購入がアプリを開いたときに届く場合もここで受け取る
 */
export function useBillingListener() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const signedIn = !!session;

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    const updated = purchaseUpdatedListener((purchase) => {
      if (!active) return;
      if (purchase.purchaseState === 'pending') {
        Alert.alert('お支払いの完了をお待ちしています', 'お支払いが済むと、自動で有効になります。');
        return;
      }
      verifyAndFinish(purchase, qc)
        .then((r) => {
          if (!r) return;
          if (r.status === 'pending') Alert.alert('お支払いの完了をお待ちしています', 'お支払いが済むと、自動で有効になります。');
          else if (purchase.productId === BILLING_PRODUCTS.plusMonthly) Alert.alert('複数台プランをお申し込みいただきました', '2台目以降のクルマを登録できます。');
          else Alert.alert('事務手数料のお支払いを確認しました', '休止中のクルマの表示を戻しました。');
        })
        .catch((e: unknown) => {
          Alert.alert('購入を確認できませんでした', e instanceof Error ? e.message : '時間をおいて「購入を復元」をお試しください。');
        });
    });
    const failed = purchaseErrorListener((error) => {
      if (!active || error.code === ErrorCode.UserCancelled) return;
      Alert.alert('購入できませんでした', error.message || '時間をおいてお試しください。');
    });
    ensureConnected().catch(() => {});
    return () => {
      active = false;
      updated.remove();
      failed.remove();
    };
  }, [signedIn, qc]);
}

/** 機種変更・アプリの入れ直しのあとに、ストアの購入を取り戻す。確かめた件数を返す */
export async function restorePurchases(qc: QueryClient): Promise<number> {
  await ensureConnected();
  await restoreStorePurchases();
  const purchases = await getAvailablePurchases();
  let restored = 0;
  let lastError: unknown = null;
  for (const purchase of purchases ?? []) {
    try {
      if (await verifyAndFinish(purchase, qc)) restored++;
    } catch (e) {
      lastError = e;
    }
  }
  if (restored === 0 && lastError) throw lastError;
  return restored;
}

/** ストアの定期購入の管理画面（解約・支払い方法の変更）を開く */
export async function openSubscriptionSettings() {
  await ensureConnected();
  await deepLinkToSubscriptions({
    skuAndroid: BILLING_PRODUCTS.plusMonthly,
    packageNameAndroid: Constants.expoConfig?.android?.package ?? null,
  });
}
