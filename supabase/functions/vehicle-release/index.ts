// クルマを手放す（アプリの「車両情報と周期 → このクルマを手放す」から）。
// 乗り換え：整備工場との連携を解除し、クルマをアプリから見えなくする（記録は残す。次の持ち主が整備工場で連携し直せる）。
// 廃車：上に加えて Ledra に廃車を伝え、以後 Ledra 側でもその車両の連携・記録を受け付けないようにする。
// どちらも、以後このクルマには記録を足せない（DB のトリガーでも止めている）。
import { isIsoDate, toJstDate } from '../_shared/domain/dates.ts';
import { handle, HttpError, json, readJson, requirePost } from '../_shared/http.ts';
import { ledraClientFromEnv } from '../_shared/ledra-client.ts';
import { notifyRevoke, notifyScrapped } from '../_shared/ledra-sync.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';

interface Body {
  vehicleId: string;
  reason: 'transferred' | 'scrapped';
  /** 手放した日（日本時間の 'YYYY-MM-DD'）。未来の日は受け付けない */
  releasedOn: string;
  /** 乗り換えのとき、次の持ち主に記録を引き継いでよいか */
  shareHistory?: boolean;
}

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = await readJson<Body>(req);

    if (!body.vehicleId || (body.reason !== 'transferred' && body.reason !== 'scrapped')) {
      throw new HttpError(400, 'invalid_request');
    }
    const today = toJstDate(new Date());
    if (!body.releasedOn || !isIsoDate(body.releasedOn) || body.releasedOn > today) {
      throw new HttpError(400, 'invalid_released_on', '手放した日を、今日までの日付で選んでください。');
    }

    const { data: vehicle } = await admin
      .from('vehicles')
      .select('id')
      .eq('id', body.vehicleId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (!vehicle) throw new HttpError(404, 'vehicle_not_found', 'このクルマはすでに手放しているか、見つかりません。');

    // 先に整備工場からの取り込みを止める。Ledra への通知は届かなければ定期実行（ledra-sync）で再送する
    const scrapped = body.reason === 'scrapped';
    const { data: link } = await admin
      .from('ledra_links')
      .update({
        status: 'revoked_by_user',
        revoked_at: new Date().toISOString(),
        ...(scrapped ? { scrapped_on: body.releasedOn, scrap_notify_pending: true } : {}),
      })
      .eq('vehicle_id', vehicle.id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .select('id, ledra_link_id')
      .maybeSingle();

    const { error } = await admin
      .from('vehicles')
      .update({
        status: body.reason,
        released_on: body.releasedOn,
        released_at: new Date().toISOString(),
        history_share_consent: !scrapped && body.shareHistory === true,
      })
      .eq('id', vehicle.id)
      .eq('status', 'active');
    if (error) throw error;

    let ledra: { unlinked: boolean; scrapNotified: boolean | null } = { unlinked: false, scrapNotified: null };
    if (link) {
      const client = ledraClientFromEnv();
      // 廃車は解除より先に伝える（解除済みの連携でも受け付ける約束だが、順番どおりのほうが Ledra 側で扱いやすい）
      const scrapNotified = scrapped
        ? await notifyScrapped(admin, client, { id: link.id, ledra_link_id: link.ledra_link_id, scrapped_on: body.releasedOn })
        : null;
      const unlinked = await notifyRevoke(admin, client, link);
      ledra = { unlinked, scrapNotified };
    }

    return json({ ok: true, status: body.reason, ledraLinked: !!link, ledra });
  }),
);
