// 写真（レシート・メーター・整備明細）から記録の下書きを読み取る。画像は保存せず、読み取り後すぐ捨てる
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '../_shared/domain/costs.ts';
import { toJstDate } from '../_shared/domain/dates.ts';
import { handle, HttpError, json, readJson, requireEnv, requirePost } from '../_shared/http.ts';
import { sanitizeDraft, type DraftCategory } from '../_shared/record-draft.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';

/** base64 で約5MB（Claude に渡せる画像1枚の上限）。アプリ側で長辺1600pxに縮めてから送る */
const MAX_IMAGE_BASE64_LENGTH = 7_000_000;
const CATEGORIES: DraftCategory[] = [...EXPENSE_CATEGORIES, 'odometer'];

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

const SCHEMA = {
  type: 'object',
  properties: {
    category: nullable({ type: 'string', enum: CATEGORIES }),
    date: nullable({ type: 'string', description: 'YYYY-MM-DD' }),
    amount_yen: nullable({ type: 'integer', description: '税込の支払合計（円）' }),
    odo_km: nullable({ type: 'integer', description: 'オドメーター（総走行距離）の値（km）。トリップメーターは使わない' }),
    filter_changed: nullable({ type: 'boolean', description: 'オイルフィルター（エレメント）を交換したか' }),
    note: nullable({ type: 'string', description: '店名や作業内容を短く（30文字以内）' }),
  },
  required: ['category', 'date', 'amount_yen', 'odo_km', 'filter_changed', 'note'],
  additionalProperties: false,
};

const CATEGORY_GUIDE = CATEGORIES.map((c) => `${c}=${c === 'odometer' ? '走行距離だけ（メーターの写真）' : EXPENSE_CATEGORY_LABELS[c]}`).join('、');

const SYSTEM = `あなたは自動車の家計簿アプリの入力補助です。利用者が撮った写真（ガソリンスタンドや整備工場のレシート・領収書・整備明細、またはメーターパネル）から、記録に使う値を読み取ります。
- 写真に写っている値だけを返し、読み取れない項目や自信のない項目は null にする。推測で埋めない
- 金額は税込の支払合計。小計や単価、ポイントは使わない
- 走行距離はオドメーター（総走行距離）の値。トリップメーター（A/B）や燃費・航続可能距離は使わない
- 日付はレシートの日付。和暦は西暦に直す。年が書かれていなければ、今日以前で一番近い日付にする
- category は次から選ぶ：${CATEGORY_GUIDE}`;

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    await requireUser(req, adminClient());
    const { image, kind } = await readJson<{ image: string; kind: string }>(req);
    if (typeof image !== 'string' || image.length === 0 || image.length > MAX_IMAGE_BASE64_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(image)) {
      throw new HttpError(400, 'invalid_image', '写真を読み込めませんでした。撮り直してください。');
    }
    const kindHint = typeof kind === 'string' && (CATEGORIES as string[]).includes(kind) ? kind : null;
    const today = toJstDate(new Date());

    const client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      // 安全のための判定で断られたときは、サーバー側で別のモデルに引き継がせる
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            {
              type: 'text',
              text: `今日は ${today} です。${kindHint ? `利用者は「${kindHint}」の記録を入力しようとしています。` : ''}この写真から値を読み取ってください。`,
            },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      throw new HttpError(422, 'unreadable', 'この写真からは読み取れませんでした。手で入力してください。');
    }
    const text = response.content.find((b) => b.type === 'text');
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text?.type === 'text' ? text.text : '');
    } catch {
      throw new HttpError(422, 'unreadable', 'この写真からは読み取れませんでした。手で入力してください。');
    }

    return json(
      sanitizeDraft(
        {
          category: parsed.category,
          date: parsed.date,
          amountYen: parsed.amount_yen,
          odoKm: parsed.odo_km,
          filterChanged: parsed.filter_changed,
          note: parsed.note,
        },
        today,
      ),
    );
  }),
);
