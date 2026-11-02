// 定期取得（1時間ごと、pg_cron から呼ぶ）。有効な連携の差分を取り込み、届かなかった解除通知を再送する
import { handle, json, requireCronSecret, requirePost } from '../_shared/http.ts';
import { ledraClientFromEnv } from '../_shared/ledra-client.ts';
import { notifyRevoke, notifyScrapped, REVOKE_NOTIFY_FAILED, syncLink, type LedraLinkRow } from '../_shared/ledra-sync.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    requireCronSecret(req);
    const admin = adminClient();
    const ledra = ledraClientFromEnv();

    const { data: links, error } = await admin
      .from('ledra_links')
      .select('id, vehicle_id, user_id, ledra_link_id, status, sync_cursor, last_error')
      .eq('status', 'active');
    if (error) throw error;

    // 複数台プランの解約で休止中のクルマは取り込まない。位置（sync_cursor）を進めないので、表示を戻したときに止まっていた間の記録をまとめて取り込む
    const vehicleIds = [...new Set((links ?? []).map((l) => l.vehicle_id as string))];
    const inService = new Set<string>();
    for (let i = 0; i < vehicleIds.length; i += 200) {
      const { data: rows, error: e } = await admin.from('vehicles_in_service').select('id').in('id', vehicleIds.slice(i, i + 200));
      if (e) throw e;
      for (const r of rows ?? []) inService.add(r.id as string);
    }

    const summary = { ok: 0, inactive: 0, error: 0, imported: 0, removed: 0, paused: 0, revokeRetried: 0, scrapRetried: 0 };
    for (const link of (links ?? []) as LedraLinkRow[]) {
      if (!inService.has(link.vehicle_id)) {
        summary.paused++;
        continue;
      }
      const r = await syncLink(admin, ledra, link);
      summary[r.status]++;
      if (r.status === 'ok') {
        summary.imported += r.imported;
        summary.removed += r.removed;
      }
    }

    const { data: pending } = await admin
      .from('ledra_links')
      .select('id, ledra_link_id')
      .eq('status', 'revoked_by_user')
      .eq('last_error', REVOKE_NOTIFY_FAILED);
    for (const link of pending ?? []) {
      if (await notifyRevoke(admin, ledra, link)) summary.revokeRetried++;
    }

    // 廃車の通知が届いていない連携（Ledra 側の対応前・一時的な失敗）
    const { data: scrapPending } = await admin
      .from('ledra_links')
      .select('id, ledra_link_id, scrapped_on')
      .eq('scrap_notify_pending', true)
      .not('scrapped_on', 'is', null);
    for (const link of scrapPending ?? []) {
      if (await notifyScrapped(admin, ledra, link as { id: string; ledra_link_id: string; scrapped_on: string })) summary.scrapRetried++;
    }

    console.log('ledra-sync', summary);
    return json(summary);
  }),
);
