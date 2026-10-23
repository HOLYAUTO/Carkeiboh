// 定期取得（1時間ごと、pg_cron から呼ぶ）。有効な連携の差分を取り込み、届かなかった解除通知を再送する
import { handle, json, requireCronSecret, requirePost } from '../_shared/http.ts';
import { ledraClientFromEnv } from '../_shared/ledra-client.ts';
import { notifyRevoke, REVOKE_NOTIFY_FAILED, syncLink, type LedraLinkRow } from '../_shared/ledra-sync.ts';
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

    const summary = { ok: 0, inactive: 0, error: 0, imported: 0, revokeRetried: 0 };
    for (const link of (links ?? []) as LedraLinkRow[]) {
      const r = await syncLink(admin, ledra, link);
      summary[r.status]++;
      if (r.status === 'ok') summary.imported += r.imported;
    }

    const { data: pending } = await admin
      .from('ledra_links')
      .select('id, ledra_link_id')
      .eq('status', 'revoked_by_user')
      .eq('last_error', REVOKE_NOTIFY_FAILED);
    for (const link of pending ?? []) {
      if (await notifyRevoke(admin, ledra, link)) summary.revokeRetried++;
    }

    console.log('ledra-sync', summary);
    return json(summary);
  }),
);
