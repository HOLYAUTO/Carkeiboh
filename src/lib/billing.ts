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
  getStorefront,
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
import { AppError, describeError, type ErrorCode as AppErrorCode } from './error-codes';
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
  /** ストアの国・地域（iOS は JPN、Android は JP など）。読めなければ null */
  storefront: string | null;
}

/** ストアの国・地域が日本か（JPN・JP）。null（読めない）は判断しない */
export function isJapanStorefront(storefront: string | null): boolean | null {
  if (!storefront) return null;
  return ['JPN', 'JP'].includes(storefront.trim().toUpperCase());
}

/** ストアからのエラーの元の文（ストアのコードと文）。原因を調べるため画面にも出す */
function storeDetail(e: unknown): string | null {
  if (typeof e !== 'object' || e === null) return e == null ? null : String(e);
  const { code, message, debugMessage } = e as { code?: unknown; message?: unknown; debugMessage?: unknown };
  const parts = [code, message, debugMessage !== message ? debugMessage : null].filter((v) => v != null && v !== '').map(String);
  return parts.length ? `ストア：${parts.join(' / ')}` : null;
}

/** ストアのエラーを、エラーコード（docs/error-codes.md）付きのエラーにする */
export function toBillingError(e: unknown, storefront?: string | null): AppError {
  if (e instanceof AppError) return e;
  const storeCode = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : null;
  let code: AppErrorCode = 'IJ-BIL-008';
  let message = 'ストアでエラーが起きました。時間をおいてお試しください。';
  if (storeCode === ErrorCode.UserCancelled) {
    code = 'IJ-BIL-004';
    message = 'ストアの手続きが途中で終わりました。もう一度お試しください。';
  } else if (storeCode === ErrorCode.DeferredPayment || storeCode === ErrorCode.Pending) {
    code = 'IJ-BIL-005';
    message = 'お支払いの完了を待っています。お支払いが済むと、自動で有効になります。';
  } else if (storeCode === ErrorCode.NetworkError) {
    code = 'IJ-NET-001';
    message = '通信できませんでした。電波の良いところでお試しください。';
  }
  const where = storefront ? `ストアの国・地域：${storefront}` : null;
  return new AppError(code, message, [storeDetail(e), where].filter(Boolean).join('／') || null);
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
      if (subs.status === 'rejected') {
        throw new AppError('IJ-BIL-001', 'ストアにつながりませんでした。', storeDetail(subs.reason));
      }
      // 料金がドルで出る・購入が進まないときの手がかり（ストアの国・地域が日本以外だと、日本だけで配信しているアプリは買えない）
      const storefront = await getStorefront().catch(() => null);
      return {
        storefront,
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
/**
 * 利用者が「申し込む」「事務手数料を払う」を押してから、その結果が届くまでの商品ID。
 * アプリを開いたときに届く購入（定期購入の自動更新・前に確かめられなかった購入）は、知らせずに確かめるだけにする
 * （開くたびに「お申し込みいただきました」と出ないように。2026-11-25）
 */
let awaitingProductId: string | null = null;

export async function buyPlus(product: ProductSubscription, userId: string) {
  await ensureConnected();
  const offerToken = product.subscriptionOffers?.find((o) => o.offerTokenAndroid)?.offerTokenAndroid ?? null;
  if (Platform.OS === 'android' && !offerToken) throw new AppError('IJ-BIL-007', '料金プランを読み込めませんでした。時間をおいてお試しください。');
  awaitingProductId = product.id;
  try {
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
  } catch (e) {
    awaitingProductId = null;
    throw e;
  }
}

/** 利用者が購入の画面を閉じた（取り消した）ときのエラーか。このときは何も知らせない */
export function isPurchaseCancelled(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === ErrorCode.UserCancelled;
}

/** 復旧の事務手数料を払う。結果は useBillingListener に届く */
export async function buyRestoreFee(product: Product, userId: string) {
  await ensureConnected();
  awaitingProductId = product.id;
  try {
    await requestPurchase({
      type: 'in-app',
      request: {
        apple: { sku: product.id, appAccountToken: userId },
        google: { skus: [product.id], obfuscatedAccountId: userId },
      },
    });
  } catch (e) {
    awaitingProductId = null;
    throw e;
  }
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
    }).catch((e: unknown) => {
      const inner = e instanceof AppError ? `${e.code} ${e.message}${e.detail ? `（${e.detail}）` : ''}` : String(e);
      throw new AppError('IJ-BIL-006', '購入を確認できませんでした。時間をおいて「購入を復元」をお試しください。', inner);
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
      // 利用者がいま申し込んだ購入だけを知らせる。それ以外（自動更新・開いたときに届き直した購入）は黙って確かめる
      const requested = awaitingProductId !== null && awaitingProductId === purchase.productId;
      if (purchase.purchaseState === 'pending') {
        if (requested) Alert.alert('お支払いの完了をお待ちしています', 'お支払いが済むと、自動で有効になります。');
        return;
      }
      verifyAndFinish(purchase, qc)
        .then((r) => {
          if (!r || !requested) return;
          awaitingProductId = null;
          if (r.status === 'pending') Alert.alert('お支払いの完了をお待ちしています', 'お支払いが済むと、自動で有効になります。');
          else if (purchase.productId === BILLING_PRODUCTS.plusMonthly) Alert.alert('複数台プランをお申し込みいただきました', '2台目以降のクルマを登録できます。');
          else Alert.alert('事務手数料のお支払いを確認しました', '休止中のクルマの表示を戻しました。');
        })
        .catch((e: unknown) => {
          // 申し込んだ直後でなければ知らせない（次に開いたとき・定期実行で確かめ直す）
          if (!requested) return;
          awaitingProductId = null;
          Alert.alert('購入を確認できませんでした', describeError(e, 'IJ-BIL-006'));
        });
    });
    const failed = purchaseErrorListener((error) => {
      if (!active) return;
      awaitingProductId = null;
      if (error.code === ErrorCode.UserCancelled) return;
      Alert.alert('購入できませんでした', describeError(toBillingError(error)));
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
