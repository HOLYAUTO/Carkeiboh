// 車検証（自動車検査証・電子車検証の記録事項）の写真から、記載内容を読み取る。画像は保存せず、読み取り後すぐ捨てる
import { toJstDate } from '../_shared/domain/dates.ts';
import { sanitizeCertificateDraft } from '../_shared/certificate-draft.ts';
import { handle, json, readJson, requirePost } from '../_shared/http.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';
import { nullable, readImageJson, requireImage } from '../_shared/vision.ts';

const text = (description: string) => nullable({ type: 'string', description });
const int = (description: string) => nullable({ type: 'integer', description });

const FIELDS = {
  registration_number: text('自動車登録番号または車両番号（例：品川 300 あ 12-34）'),
  registered_on: text('登録年月日／交付年月日（YYYY-MM-DD）'),
  first_registered_on: text('初度登録年月（軽は初度検査年月）（YYYY-MM）'),
  expires_on: text('有効期間の満了する日（YYYY-MM-DD）'),
  kind_text: text('自動車の種別（普通・小型・軽自動車・大型特殊・小型特殊）'),
  usage_text: text('用途（乗用・貨物・乗合・特種）'),
  business_text: text('自家用・事業用の別'),
  body_shape: text('車体の形状'),
  maker: text('車名'),
  model_code: text('型式'),
  chassis_number: text('車台番号'),
  engine_model: text('原動機の型式'),
  displacement_cc: int('総排気量（cc）。「1.49L」なら 1490、「1490cc」なら 1490'),
  fuel_text: text('燃料の種類（ガソリン・軽油・電気・ガソリン・電気 など）'),
  seating_capacity: int('乗車定員（人）'),
  max_load_kg: int('最大積載量（kg）。記載がなければ null'),
  vehicle_weight_kg: int('車両重量（kg）'),
  gross_weight_kg: int('車両総重量（kg）'),
  length_cm: int('長さ（cm）'),
  width_cm: int('幅（cm）'),
  height_cm: int('高さ（cm）'),
  axle_ff_kg: int('前前軸重（kg）'),
  axle_fr_kg: int('前後軸重（kg）'),
  axle_rf_kg: int('後前軸重（kg）'),
  axle_rr_kg: int('後後軸重（kg）'),
  type_designation_number: text('型式指定番号'),
  category_number: text('類別区分番号'),
  owner_name: text('所有者の氏名又は名称'),
  owner_address: text('所有者の住所'),
  user_name: text('使用者の氏名又は名称'),
  user_address: text('使用者の住所'),
  base_location: text('使用の本拠の位置'),
  remarks: text('備考（200文字以内）'),
};

const SCHEMA = { type: 'object', properties: FIELDS, required: Object.keys(FIELDS), additionalProperties: false };

const SYSTEM = `あなたは自動車の家計簿アプリの入力補助です。利用者が撮った車検証（自動車検査証、電子車検証の「自動車検査証記録事項」を含む）の写真から、記載内容を読み取ります。
- 写真に写っている値だけを返し、読み取れない項目や自信のない項目は null にする。推測で埋めない
- 和暦（令和・平成・昭和）は西暦に直す。「令和2年6月」→「2020-06」
- 「-」「＊」や空欄の項目は null
- 文字は車検証の表記のまま。数字は半角にする
- 車検証ではない写真なら、すべて null にする`;

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    await requireUser(req, adminClient());
    const { image } = await readJson<{ image: string }>(req);
    const parsed = await readImageJson({
      image: requireImage(image),
      schema: SCHEMA,
      system: SYSTEM,
      prompt: 'この車検証の写真から記載内容を読み取ってください。',
    });
    return json(sanitizeCertificateDraft(parsed, toJstDate(new Date())));
  }),
);
