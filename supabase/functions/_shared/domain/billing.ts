/**
 * 複数台プランの課金（App Store / Google Play のアプリ内課金）。
 * アプリの購入画面と、購入を確かめる Edge Functions（billing-verify など）の両方で使う。
 * 料金は各ストアで設定する（仮に月額500円・事務手数料1,000円。docs/open-questions.md 30）。
 */

/** ストアに登録する商品ID（App Store Connect と Google Play Console で同じIDにする） */
export const BILLING_PRODUCTS = {
  /** 複数台プラン（自動更新の定期購入・1か月） */
  plusMonthly: 'ijilog_plus_monthly',
  /** 休止から90日を過ぎたクルマの表示を戻す、復旧の事務手数料（1回限りの購入・消費型） */
  restoreFee: 'ijilog_restore_fee',
} as const;

export type BillingKind = 'subscription' | 'restore_fee';

export function billingKindOf(productId: string): BillingKind | null {
  if (productId === BILLING_PRODUCTS.plusMonthly) return 'subscription';
  if (productId === BILLING_PRODUCTS.restoreFee) return 'restore_fee';
  return null;
}

/** 休止から、事務手数料なしで表示を戻せる日数（DB の plan_restore_grace_days と同じ値） */
export const PLAN_RESTORE_GRACE_DAYS = 90;

const DAY_MS = 86_400_000;

/** 事務手数料なしで戻せる残りの日数（切り上げ。期限を過ぎていれば 0） */
export function restoreFreeDaysLeft(restoreFreeUntil: string, now: Date): number {
  const left = Date.parse(restoreFreeUntil) - now.getTime();
  return left <= 0 ? 0 : Math.ceil(left / DAY_MS);
}
