// 写真から値を読み取る（read-* の Edge Function で共通）。画像は保存せず、読み取り後すぐ捨てる
import Anthropic from 'npm:@anthropic-ai/sdk@0.132.1';
import { HttpError, requireEnv } from './http.ts';

/** base64 で約5MB（Claude に渡せる画像1枚の上限）。アプリ側で長辺を縮めてから送る */
const MAX_IMAGE_BASE64_LENGTH = 7_000_000;
const MODEL = 'claude-opus-5-5';
const DEFAULT_UNREADABLE = 'この写真からは読み取れませんでした。手で入力してください。';

/** JSON スキーマで「その値か null」 */
export const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

/** 送られてきた画像（JPEG の base64）を確かめて返す */
export function requireImage(image: unknown): string {
  if (typeof image !== 'string' || image.length === 0 || image.length > MAX_IMAGE_BASE64_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(image)) {
    throw new HttpError(400, 'invalid_image', '写真を読み込めませんでした。撮り直してください。');
  }
  return image;
}

/** 写真を Claude に渡し、schema の形の JSON を受け取る。断られた・読めなかったときは 422 にする */
export async function readImageJson({
  image,
  schema,
  system,
  prompt,
  unreadableMessage = DEFAULT_UNREADABLE,
}: {
  image: string;
  schema: Record<string, unknown>;
  system: string;
  prompt: string;
  unreadableMessage?: string;
}): Promise<Record<string, unknown>> {
  const client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // 安全のための判定で断られたときは、サーバー側で別のモデルに引き継がせる
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const unreadable = new HttpError(422, 'unreadable', unreadableMessage);
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw unreadable;
  const block = response.content.find((b) => b.type === 'text');
  try {
    return JSON.parse(block?.type === 'text' ? block.text : '');
  } catch {
    throw unreadable;
  }
}
