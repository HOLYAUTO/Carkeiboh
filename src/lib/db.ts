/** Supabase を読み書きするときの共通の手順 */
import { AppError, codeForDbError } from './error-codes';
import { supabase } from './supabase';

/** 結果から data を取り出す。エラーなら、エラーコード（docs/error-codes.md）付きの例外にする */
export function unwrap<T>(res: { data: T | null; error: { message: string; code?: string | null } | null }): T {
  if (res.error) throw new AppError(codeForDbError(res.error), res.error.message, res.error.code ? `DB ${res.error.code}` : null);
  return res.data as T;
}

/** id があればその行を更新し、なければ追加する。保存した行の id を返す */
export async function saveRow(table: string, row: Record<string, unknown>, id?: string): Promise<{ id: string }> {
  return unwrap(
    id ? await supabase.from(table).update(row).eq('id', id).select('id').single() : await supabase.from(table).insert(row).select('id').single(),
  ) as { id: string };
}

export async function deleteRow(table: string, id: string) {
  unwrap(await supabase.from(table).delete().eq('id', id));
}

/** Storage に上げるため、base64 をバイト列にする */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
