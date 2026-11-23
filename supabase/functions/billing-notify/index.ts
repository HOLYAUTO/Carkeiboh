// ストアからの通知（更新・解約・返金など）を受け取る。
//   App Store：App Store Server Notifications V2 → https://<project>.supabase.co/functions/v1/billing-notify?source=apple&key=<BILLING_NOTIFY_SECRET>
//   Google Play：リアルタイム デベロッパー通知（Pub/Sub の push）→ 同じ URL の source=google
// 通知の中身は「どの購入が変わったか」を知るためだけに使い、状態は必ずストアの API で取り直す。
// そのため通知の署名は確かめず、URL の key で送り元を絞る。
import { billingKindOf } from '../_shared/domain/billing.ts';
import {
  fetchStorePurchase,
  findStoredPurchase,
  refreshStoredPurchase,
  revokeStoredPurchase,
  saveForAccountToken,
  StoreClients,
  type Platform,
} from '../_shared/billing-sync.ts';
import type { AppleTransaction } from '../_shared/billing-stores.ts';
import { handle, HttpError, json, readJson, requireEnv, requirePost, timingSafeEqual } from '../_shared/http.ts';
import { decodeJwsPayload } from '../_shared/jwt.ts';
import { adminClient, type SupabaseClient } from '../_shared/supabase.ts';

interface AppleNotification {
  notificationType?: string;
  data?: { bundleId?: string; signedTransactionInfo?: string };
}

interface GoogleNotification {
  packageName?: string;
  subscriptionNotification?: { purchaseToken?: string; subscriptionId?: string };
  oneTimeProductNotification?: { purchaseToken?: string; sku?: string };
  voidedPurchaseNotification?: { purchaseToken?: string };
  testNotification?: unknown;
}

/** 記録済みならストアで取り直し、まだ無ければ購入に付いた利用者IDの人のものとして記録する */
async function refresh(admin: SupabaseClient, stores: StoreClients, platform: Platform, productId: string, lookupRef: string, fetchRef: string) {
  const kind = billingKindOf(productId);
  if (!kind) return 'ignored';
  const stored = await findStoredPurchase(admin, platform, lookupRef);
  if (stored) {
    await refreshStoredPurchase(admin, stores, stored);
    return 'refreshed';
  }
  const p = await fetchStorePurchase(stores, platform, kind, fetchRef);
  if (p) await saveForAccountToken(admin, stores, p);
  return 'new';
}

async function handleApple(admin: SupabaseClient, stores: StoreClients, body: { signedPayload?: string }) {
  if (!body.signedPayload) throw new HttpError(400, 'invalid_request');
  const n = decodeJwsPayload<AppleNotification>(body.signedPayload);
  if (n.notificationType === 'TEST' || !n.data?.signedTransactionInfo) return 'ignored';
  if (n.data.bundleId && n.data.bundleId !== stores.apple.bundleId) return 'ignored';
  const tx = decodeJwsPayload<AppleTransaction>(n.data.signedTransactionInfo);
  // 定期購入は originalTransactionId、1回限りの購入は transactionId で記録している
  const lookupRef = billingKindOf(tx.productId) === 'subscription' ? tx.originalTransactionId : tx.transactionId;
  return refresh(admin, stores, 'ios', tx.productId, lookupRef, tx.transactionId);
}

async function handleGoogle(admin: SupabaseClient, stores: StoreClients, body: { message?: { data?: string } }) {
  if (!body.message?.data) throw new HttpError(400, 'invalid_request');
  const n = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.message.data), (c) => c.charCodeAt(0)))) as GoogleNotification;
  if (n.testNotification || (n.packageName && n.packageName !== stores.google.packageName)) return 'ignored';

  const voided = n.voidedPurchaseNotification?.purchaseToken;
  if (voided) {
    await revokeStoredPurchase(admin, 'android', voided);
    return 'revoked';
  }
  const sub = n.subscriptionNotification;
  if (sub?.purchaseToken && sub.subscriptionId) return refresh(admin, stores, 'android', sub.subscriptionId, sub.purchaseToken, sub.purchaseToken);
  const one = n.oneTimeProductNotification;
  if (one?.purchaseToken && one.sku) return refresh(admin, stores, 'android', one.sku, one.purchaseToken, one.purchaseToken);
  return 'ignored';
}

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    const url = new URL(req.url);
    // 管理画面に貼るときに入りがちな前後の空白・改行は無視する（URL に入れる値と食い違わないように）
    if (!timingSafeEqual(url.searchParams.get('key') ?? '', requireEnv('BILLING_NOTIFY_SECRET').trim())) throw new HttpError(401, 'unauthorized');

    const admin = adminClient();
    const stores = new StoreClients();
    const source = url.searchParams.get('source');
    let result: string;
    if (source === 'apple') result = await handleApple(admin, stores, await readJson<{ signedPayload: string }>(req));
    else if (source === 'google') result = await handleGoogle(admin, stores, await readJson<{ message: { data: string } }>(req));
    else throw new HttpError(400, 'invalid_source');

    console.log('billing-notify', source, result);
    // ストアは 2xx 以外を受け取ると送り直す。取り直しに失敗したときは例外で 500 を返し、送り直してもらう
    return json({ ok: true, result });
  }),
);
