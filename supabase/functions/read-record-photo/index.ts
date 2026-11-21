// 写真（レシート・メーター・整備明細）から記録の下書きを読み取る。画像は保存せず、読み取り後すぐ捨てる
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '../_shared/domain/costs.ts';
import { FUEL_TYPES } from '../_shared/domain/fuel.ts';
import { isDistanceUnit } from '../_shared/domain/units.ts';
import { toJstDate } from '../_shared/domain/dates.ts';
import { handle, json, readJson, requirePost } from '../_shared/http.ts';
import { sanitizeDraft, type DraftCategory } from '../_shared/record-draft.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';
import { nullable, readImageJson, requireImage } from '../_shared/vision.ts';

const CATEGORIES: DraftCategory[] = [...EXPENSE_CATEGORIES, 'odometer'];

const SCHEMA = {
  type: 'object',
  properties: {
    category: nullable({ type: 'string', enum: CATEGORIES }),
    date: nullable({ type: 'string', description: 'YYYY-MM-DD' }),
    amount_yen: nullable({ type: 'integer', description: '税込の支払合計（円）' }),
    odo: nullable({ type: 'integer', description: 'オドメーター（総走行距離）に表示された数。km・mile の換算はしない。トリップメーターは使わない' }),
    filter_changed: nullable({ type: 'boolean', description: 'オイルフィルター（エレメント）を交換したか' }),
    fuel_liters: nullable({ type: 'number', description: '給油量（L、小数2桁まで）' }),
    fuel_unit_price: nullable({ type: 'number', description: '1Lあたりの単価（円、小数1桁まで）' }),
    fuel_type: nullable({ type: 'string', enum: [...FUEL_TYPES], description: 'regular=レギュラー、premium=ハイオク、diesel=軽油' }),
    full_tank: nullable({ type: 'boolean', description: 'レシートに「満タン」と書かれていれば true。書かれていなければ null' }),
    note: nullable({ type: 'string', description: '店名や作業内容を短く（30文字以内）' }),
  },
  required: ['category', 'date', 'amount_yen', 'odo', 'filter_changed', 'fuel_liters', 'fuel_unit_price', 'fuel_type', 'full_tank', 'note'],
  additionalProperties: false,
};

const CATEGORY_GUIDE = CATEGORIES.map((c) => `${c}=${c === 'odometer' ? '走行距離だけ（メーターの写真）' : EXPENSE_CATEGORY_LABELS[c]}`).join('、');

const SYSTEM = `あなたは自動車の家計簿アプリの入力補助です。利用者が撮った写真（ガソリンスタンドや整備工場のレシート・領収書・整備明細、またはメーターパネル）から、記録に使う値を読み取ります。
- 写真に写っている値だけを返し、読み取れない項目や自信のない項目は null にする。推測で埋めない
- 金額は税込の支払合計。小計や単価、ポイントは使わない
- 走行距離はオドメーター（総走行距離）の値。トリップメーター（A/B）や燃費・航続可能距離は使わない。km と mile の換算はせず、表示された数をそのまま返す
- 給油のレシートなら、給油量（L）・1Lあたりの単価・油種も読む。単価は値引き前の店頭の単価ではなく、実際に支払った単価
- 日付はレシートの日付。和暦は西暦に直す。年が書かれていなければ、今日以前で一番近い日付にする
- category は次から選ぶ：${CATEGORY_GUIDE}`;

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    await requireUser(req, adminClient());
    const { image, kind, unit } = await readJson<{ image: string; kind: string; unit?: string }>(req);
    const kindHint = typeof kind === 'string' && (CATEGORIES as string[]).includes(kind) ? kind : null;
    const today = toJstDate(new Date());
    const mileHint = isDistanceUnit(unit) && unit === 'mile' ? 'このクルマのメーターは mile 表示です。' : '';
    const parsed = await readImageJson({
      image: requireImage(image),
      schema: SCHEMA,
      system: SYSTEM,
      prompt: `今日は ${today} です。${kindHint ? `利用者は「${kindHint}」の記録を入力しようとしています。` : ''}${mileHint}この写真から値を読み取ってください。`,
    });

    const draft = sanitizeDraft(
      {
        category: parsed.category,
        date: parsed.date,
        amountYen: parsed.amount_yen,
        odo: parsed.odo,
        filterChanged: parsed.filter_changed,
        fuelLiters: parsed.fuel_liters,
        fuelUnitPrice: parsed.fuel_unit_price,
        fuelType: parsed.fuel_type,
        fullTank: parsed.full_tank,
        note: parsed.note,
      },
      today,
    );
    // 2026-11-05 より前のアプリは走行距離を odoKm で読むので、更新が行き渡るまで同じ値を両方に入れる
    return json(draft.odo != null ? { ...draft, odoKm: draft.odo } : draft);
  }),
);
