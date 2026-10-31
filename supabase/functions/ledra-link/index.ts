// 連携の確定：アプリで読み取った QR のトークンと同意を受け、Ledra に連携を確定させる
import { handle, HttpError, json, readJson, requirePost } from '../_shared/http.ts';
import { LedraAlreadyLinkedError, ledraClientFromEnv, LedraTokenError, type LedraConsent } from '../_shared/ledra-client.ts';
import {
  CONSENT_ITEMS,
  CONSENT_RECIPIENT,
  CONSENT_VERSION,
  extractLinkToken,
  TOKEN_INVALID_MESSAGE,
} from '../_shared/ledra-records.ts';
import { LEDRA_LINK_COLUMNS, syncLink, type LedraLinkRow } from '../_shared/ledra-sync.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';

interface Body {
  vehicleId: string;
  qrData: string;
  /** アプリが表示した同意画面の版。サーバーの版と違えば同意をやり直してもらう */
  consentVersion: string;
}

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = await readJson<Body>(req);

    const token = extractLinkToken(body.qrData ?? '');
    if (!token || !body.vehicleId) throw new HttpError(400, 'invalid_request', '連携用のQRコードではありません。');
    if (body.consentVersion !== CONSENT_VERSION) {
      throw new HttpError(409, 'consent_outdated', '同意画面の内容が更新されました。アプリを最新にして、もう一度お試しください。');
    }

    const { data: vehicle } = await admin
      .from('vehicles')
      .select('id')
      .eq('id', body.vehicleId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!vehicle) throw new HttpError(404, 'vehicle_not_found');

    const { data: active } = await admin
      .from('ledra_links')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .eq('status', 'active')
      .maybeSingle();
    if (active) throw new HttpError(409, 'already_linked', 'この車両はすでに整備工場と連携しています。');

    const ledra = ledraClientFromEnv();
    let confirmed: { linkId: string; shopName: string | null };
    const linkRowId = crypto.randomUUID();
    const agreedAt = new Date().toISOString();
    let consent: LedraConsent;
    try {
      // 同意画面に出したのと同じ照会で提供元を確かめ、同意の控えに残す
      const preview = await ledra.previewToken(token);
      consent = {
        version: CONSENT_VERSION,
        recipient: CONSENT_RECIPIENT,
        items: CONSENT_ITEMS,
        agreed_at: agreedAt,
        consumer_link_ref: linkRowId,
        provider_shop_name: preview.shopName,
      };
      confirmed = await ledra.confirmLink(token, consent);
    } catch (e) {
      if (e instanceof LedraTokenError) {
        throw new HttpError(410, 'token_invalid', TOKEN_INVALID_MESSAGE);
      }
      if (e instanceof LedraAlreadyLinkedError) {
        throw new HttpError(
          409,
          'already_linked',
          'この車両は、すでにカーケイボーと連携しています（別のアカウントで連携している可能性があります）。前の連携を解除してからお試しください。',
        );
      }
      throw e;
    }

    const { data: link, error } = await admin
      .from('ledra_links')
      .insert({
        id: linkRowId,
        vehicle_id: vehicle.id,
        user_id: user.id,
        ledra_link_id: confirmed.linkId,
        consent: { ...consent, shop_name: confirmed.shopName ?? consent.provider_shop_name },
        consented_at: agreedAt,
      })
      .select(LEDRA_LINK_COLUMNS)
      .single();
    if (error || !link) {
      // こちらで記録できなかった連携は Ledra 側でも解除しておく（同意の記録がない提供をしないため）
      await ledra.revokeLink(confirmed.linkId).catch((e) => console.error(e));
      throw new Error(`連携の保存に失敗しました: ${error?.message}`);
    }

    // 初回の取り込み。失敗しても連携自体は成立しているので、次の定期取得に任せる
    const result = await syncLink(admin, ledra, link as LedraLinkRow);
    return json({ linkId: link.id, shopName: confirmed.shopName ?? consent.provider_shop_name, sync: result });
  }),
);
