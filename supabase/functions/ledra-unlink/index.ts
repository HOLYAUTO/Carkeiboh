// 連携の解除（アプリの設定画面から）。こちらの取得を先に止め、Ledra への通知は届かなければ定期実行で再送する
import { handle, HttpError, json, readJson, requirePost } from '../_shared/http.ts';
import { ledraClientFromEnv } from '../_shared/ledra-client.ts';
import { notifyRevoke } from '../_shared/ledra-sync.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const { linkId } = await readJson<{ linkId: string }>(req);
    if (!linkId) throw new HttpError(400, 'invalid_request');

    const { data: link } = await admin
      .from('ledra_links')
      .update({ status: 'revoked_by_user', revoked_at: new Date().toISOString() })
      .eq('id', linkId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .select('id, ledra_link_id')
      .maybeSingle();
    if (!link) throw new HttpError(404, 'link_not_found');

    const notified = await notifyRevoke(admin, ledraClientFromEnv(), link);
    return json({ ok: true, notified });
  }),
);
