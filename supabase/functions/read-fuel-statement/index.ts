// 掛けカード（ガソリンスタンドの後払いのカード）の月の明細の写真から、給油の行を読み取る。画像は保存せず、読み取り後すぐ捨てる
import { toJstDate } from '../_shared/domain/dates.ts';
import { FUEL_TYPES } from '../_shared/domain/fuel.ts';
import { sanitizeStatement } from '../_shared/fuel-statement.ts';
import { handle, json, readJson, requirePost } from '../_shared/http.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';
import { nullable, readImageJson, requireImage } from '../_shared/vision.ts';

const ROW = {
  type: 'object',
  properties: {
    date: { type: 'string', description: '給油した日（YYYY-MM-DD）' },
    station: nullable({ type: 'string', description: '給油所の名前' }),
    fuel_type: nullable({ type: 'string', enum: [...FUEL_TYPES], description: 'regular=レギュラー、premium=ハイオク、diesel=軽油' }),
    liters: nullable({ type: 'number', description: '数量（L）' }),
    unit_price: nullable({ type: 'number', description: '1Lあたりの単価（明細の表記のまま）' }),
    amount_yen: nullable({ type: 'integer', description: 'その行の金額（明細の表記のまま）' }),
  },
  required: ['date', 'station', 'fuel_type', 'liters', 'unit_price', 'amount_yen'],
  additionalProperties: false,
};

const SCHEMA = {
  type: 'object',
  properties: {
    rows: { type: 'array', items: ROW },
    unit_price_includes_tax: nullable({ type: 'boolean', description: '明細の単価・金額が消費税込みなら true、税抜なら false、分からなければ null' }),
    total_yen: nullable({ type: 'integer', description: '請求の合計（税込）' }),
  },
  required: ['rows', 'unit_price_includes_tax', 'total_yen'],
  additionalProperties: false,
};

const SYSTEM = `あなたは自動車の家計簿アプリの入力補助です。利用者が撮った、ガソリンスタンドの掛けカード（後払いのカード）の請求明細・利用明細の写真から、給油の行を読み取ります。
- 給油（ガソリン・軽油）の行だけを返す。洗車・オイル・物品・値引き・小計・消費税・軽油引取税・合計の行は rows に入れない
- 写真に写っている値だけを返し、読み取れない項目は null にする。推測で埋めない
- 和暦は西暦に直す。年が書かれていなければ、請求月から考えて今日以前で一番近い日付にする
- 数字は半角にする
- 明細ではない写真なら rows を空にする`;

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    await requireUser(req, adminClient());
    const { image } = await readJson<{ image: string }>(req);
    const today = toJstDate(new Date());
    const parsed = await readImageJson({
      image: requireImage(image),
      schema: SCHEMA,
      system: SYSTEM,
      prompt: `今日は ${today} です。この明細から給油の行を読み取ってください。`,
      unreadableMessage: 'この写真からは読み取れませんでした。',
    });
    return json(sanitizeStatement(parsed, today));
  }),
);
