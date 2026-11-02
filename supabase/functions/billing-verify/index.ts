// アプリで購入・復元した直後に呼ぶ。ストアに購入の状態をたずねて記録し、休止中のクルマで戻せるものを戻す。
// アプリは、この確認が済んでから購入を完了（finishTransaction）にする。
import { billingKindOf } from '../_shared/domain/billing.ts';
import { acknowledgeIfNeeded, fetchStorePurchase, savePurchase, StoreClients } from '../_shared/billing-sync.ts';
import { handle, HttpError, json, readJson, requirePost } from '../_shared/http.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';

interface Body {
  platform: 'ios' | 'android';
  productId: string;
  /** iOS：取引ID（transactionId）。Android：購入トークン（purchaseToken） */
  storeRef: string;
}

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = await readJson<Body>(req);

    if ((body.platform !== 'ios' && body.platform !== 'android') || typeof body.productId !== 'string' || typeof body.storeRef !== 'string') {
      throw new HttpError(400, 'invalid_request');
    }
    if (body.storeRef.length === 0 || body.storeRef.length > 4096) throw new HttpError(400, 'invalid_request');
    const kind = billingKindOf(body.productId);
    if (!kind) throw new HttpError(400, 'unknown_product', 'この商品は取り扱っていません。');

    const stores = new StoreClients();
    const purchase = await fetchStorePurchase(stores, body.platform, kind, body.storeRef);
    if (!purchase) throw new HttpError(404, 'purchase_not_found', '購入を確認できませんでした。時間をおいて「購入を復元」をお試しください。');

    const result = await savePurchase(admin, purchase, user.id);
    if (result === 'saved') await acknowledgeIfNeeded(stores, purchase);

    return json({
      ok: true,
      kind,
      // pending：支払いが済んでいない（コンビニ払いなど）。済んだらストアからの通知で記録する
      status: result,
      entitled:
        purchase.kind === 'subscription'
          ? purchase.revokedAt === null && purchase.entitledUntil !== null && Date.parse(purchase.entitledUntil) > Date.now()
          : purchase.completed && purchase.revokedAt === null,
    });
  }),
);
