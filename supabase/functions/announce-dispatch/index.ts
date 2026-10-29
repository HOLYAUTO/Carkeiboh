// お知らせのプッシュ通知（10分ごと、pg_cron から呼ぶ）。
// 「公開と同時に通知する」を選んだお知らせのうち、公開日時を過ぎてまだ送っていないものを送る。
// アップデート・修正のお知らせは通知を許可した全員に、たにぐち自動車の最新情報は「受け取る」を選んだ利用者だけに送る。
import { announcementPushMessage, type AnnouncementCategory } from '../_shared/domain/announcements.ts';
import { sendPush } from '../_shared/expo-push.ts';
import { handle, json, readJson, requireCronSecret, requirePost } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';

interface Body {
  /** 試験用：送らずに、送る予定のお知らせと送り先の数だけ返す */
  dryRun?: boolean;
}

interface AnnouncementRow {
  id: string;
  category: AnnouncementCategory;
  title: string;
  body: string;
}

const TOKEN_PAGE = 500;

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    requireCronSecret(req);
    const body = await readJson<Body>(req).catch(() => ({}) as Body);
    const admin = adminClient();
    const now = new Date().toISOString();

    /** 送り先のトークンを、トークンの順に1ページずつ取る（after より後ろ） */
    const tokenPage = async (category: AnnouncementCategory, after: string | null): Promise<string[]> => {
      const { data, error } = await admin.rpc('announcement_push_tokens', { p_category: category, p_after: after, p_limit: TOKEN_PAGE });
      if (error) throw error;
      return ((data ?? []) as { token: string }[]).map((r) => r.token);
    };

    const { data: due, error } = await admin
      .from('announcements')
      .select('id, category, title, body')
      .eq('is_published', true)
      .eq('send_push', true)
      .is('pushed_at', null)
      .lte('published_at', now)
      .or(`expires_at.is.null,expires_at.gt."${now}"`)
      .order('published_at');
    if (error) throw error;

    const summary = { announcements: 0, tokens: 0, sent: 0, removedTokens: 0, preview: [] as unknown[] };

    for (const a of (due ?? []) as AnnouncementRow[]) {
      const message = announcementPushMessage(a);
      if (body.dryRun) {
        let count = 0;
        for (let after: string | null = null; ; ) {
          const tokens = await tokenPage(a.category, after);
          count += tokens.length;
          if (tokens.length < TOKEN_PAGE) break;
          after = tokens[tokens.length - 1];
        }
        summary.preview.push({ id: a.id, ...message, tokens: count });
        continue;
      }

      // 先に送信済みとして記録し、同時実行や再実行で二重に送らないようにする
      const { data: claimed, error: claimError } = await admin
        .from('announcements')
        .update({ pushed_at: new Date().toISOString() })
        .eq('id', a.id)
        .is('pushed_at', null)
        .select('id');
      if (claimError) throw claimError;
      if (!claimed || claimed.length === 0) continue;
      summary.announcements++;

      let accepted = 0;
      try {
        for (let after: string | null = null; ; ) {
          const tokens = await tokenPage(a.category, after);
          summary.tokens += tokens.length;
          if (tokens.length > 0) {
            const result = await sendPush(
              tokens.map((to) => ({ to, ...message, channelId: 'announcements', data: { kind: 'announcement', announcementId: a.id } })),
            );
            accepted += result.accepted.length;
            if (result.unregistered.length > 0) {
              await admin.from('push_tokens').delete().in('token', result.unregistered);
              summary.removedTokens += result.unregistered.length;
            }
          }
          if (tokens.length < TOKEN_PAGE) break;
          after = tokens[tokens.length - 1];
        }
      } catch (e) {
        // 1件も送れていなければ記録を戻し、次の回に送り直す（途中まで送れた分は、二重に届かないよう送り直さない）
        if (accepted === 0) await admin.from('announcements').update({ pushed_at: null }).eq('id', a.id);
        console.error(e);
      }
      summary.sent += accepted;
    }

    console.log('announce-dispatch', { ...summary, preview: summary.preview.length });
    return json(summary);
  }),
);
