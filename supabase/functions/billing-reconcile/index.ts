// 定期実行（1日1回、pg_cron から呼ぶ）。ストアからの通知が届かなかった場合に備えて、
// 期限の前後にある定期購入の状態をストアで取り直す（更新されていれば期限が延び、解約されていれば期限で無料プランに戻る）。
import { refreshStoredPurchase, StoreClients, type StoredPurchase } from '../_shared/billing-sync.ts';
import { handle, json, requireCronSecret, requirePost } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';

const DAY_MS = 86_400_000;

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    requireCronSecret(req);
    const admin = adminClient();
    const stores = new StoreClients();

    const now = Date.now();
    const from = new Date(now - 7 * DAY_MS).toISOString();
    const to = new Date(now + 2 * DAY_MS).toISOString();
    // 期限が過去7日〜2日後のもの。期限の無い（支払いの再試行中など）ものは、最後の確認から1日以上たっていれば取り直す
    const { data, error } = await admin
      .from('billing_purchases')
      .select('user_id, platform, kind, store_ref')
      .eq('kind', 'subscription')
      .is('revoked_at', null)
      .or(
        `and(entitled_until.gte.${from},entitled_until.lte.${to}),and(entitled_until.is.null,last_verified_at.gte.${from},last_verified_at.lte.${new Date(now - DAY_MS).toISOString()})`,
      )
      .limit(500);
    if (error) throw error;

    const summary = { checked: 0, error: 0 };
    for (const row of (data ?? []) as StoredPurchase[]) {
      try {
        await refreshStoredPurchase(admin, stores, row);
        summary.checked++;
      } catch (e) {
        console.error('billing-reconcile', row.platform, e);
        summary.error++;
      }
    }
    console.log('billing-reconcile', summary);
    return json(summary);
  }),
);
