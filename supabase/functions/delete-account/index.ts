// アカウント削除（App Store の審査で必須）。Ledra 連携を解除してから、利用者とすべてのデータを削除する
import { handle, json, requirePost } from '../_shared/http.ts';
import { ledraClientFromEnv } from '../_shared/ledra-client.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    const admin = adminClient();
    const user = await requireUser(req, admin);

    const { data: links } = await admin
      .from('ledra_links')
      .select('ledra_link_id')
      .eq('user_id', user.id)
      .eq('status', 'active');
    if (links && links.length > 0) {
      const ledra = ledraClientFromEnv();
      for (const link of links) {
        // 解除の通知が届かなくても削除は止めない（以後こちらから取得することはない）
        await ledra.revokeLink(link.ledra_link_id).catch((e) => console.error('Ledra への解除通知に失敗', e));
      }
    }

    // auth.users の削除で、各テーブルのデータは外部キーの連鎖で消える
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
    return json({ ok: true });
  }),
);
