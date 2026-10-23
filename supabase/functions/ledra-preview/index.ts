// 同意画面の表示前に、QR を表示した整備工場（提供元）を確かめる。トークンは消費しない
import { handle, HttpError, json, readJson, requirePost } from '../_shared/http.ts';
import { ledraClientFromEnv, LedraTokenError } from '../_shared/ledra-client.ts';
import { extractLinkToken, TOKEN_INVALID_MESSAGE } from '../_shared/ledra-records.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    await requireUser(req, adminClient());
    const { qrData } = await readJson<{ qrData: string }>(req);
    const token = extractLinkToken(qrData ?? '');
    if (!token) throw new HttpError(400, 'invalid_request', '連携用のQRコードではありません。');
    try {
      return json(await ledraClientFromEnv().previewToken(token));
    } catch (e) {
      if (e instanceof LedraTokenError) throw new HttpError(410, 'token_invalid', TOKEN_INVALID_MESSAGE);
      throw e;
    }
  }),
);
