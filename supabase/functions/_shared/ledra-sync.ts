import { LedraLinkInactiveError, type LedraClient } from './ledra-client.ts';
import { toOilChangeInsert, voidedRecordId } from './ledra-records.ts';
import type { SupabaseClient } from './supabase.ts';

export interface LedraLinkRow {
  id: string;
  vehicle_id: string;
  user_id: string;
  ledra_link_id: string;
  status: 'active' | 'revoked_by_user' | 'revoked_by_provider';
  sync_cursor: string | null;
  last_error: string | null;
}

/** 1回の取得で読むページ数の上限（暴走防止。残りは次の回に取得する） */
const MAX_PAGES = 20;

export type SyncResult =
  | { status: 'ok'; imported: number; skipped: number; removed: number }
  | { status: 'inactive' }
  | { status: 'error'; message: string };

/** 前回取得以降の差分を取り込む */
export async function syncLink(admin: SupabaseClient, ledra: LedraClient, link: LedraLinkRow): Promise<SyncResult> {
  let cursor = link.sync_cursor;
  let imported = 0;
  let skipped = 0;
  let removed = 0;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const { records, nextCursor, hasMore } = await ledra.fetchOilRecords(link.ledra_link_id, cursor);
      // 整備工場が取り消した記録は消す（紐づく金額の支出も外部キーの連鎖で消える）
      const voided = records.map(voidedRecordId).filter((id) => id !== null);
      if (voided.length > 0) {
        const { data: gone, error } = await admin
          .from('oil_changes')
          .delete()
          .eq('vehicle_id', link.vehicle_id)
          .eq('source', 'ledra')
          .in('ledra_record_id', voided)
          .select('id');
        if (error) throw new Error(`取り消された記録の削除に失敗しました: ${error.message}`);
        removed += gone?.length ?? 0;
      }
      const live = records.filter((r) => voidedRecordId(r) === null);
      const rows = live.map((r) => toOilChangeInsert(r, link));
      const valid = rows.filter((r) => r !== null);
      skipped += rows.length - valid.length;
      if (valid.length > 0) {
        // Ledra 側で訂正された記録は上書きする（記録IDで重複させない）
        const { error } = await admin.from('oil_changes').upsert(valid, { onConflict: 'vehicle_id,ledra_record_id' });
        if (error) throw new Error(`記録の保存に失敗しました: ${error.message}`);
        imported += valid.length;
      }
      cursor = nextCursor;
      // 取り込みが済んだところまで、ページごとに位置を進める
      await admin
        .from('ledra_links')
        .update({ sync_cursor: cursor, last_synced_at: new Date().toISOString(), last_error: null })
        .eq('id', link.id);
      if (!hasMore) break;
    }
    if (skipped > 0) console.warn(`ledra link ${link.id}: 不正な記録 ${skipped} 件を取り込みませんでした`);
    return { status: 'ok', imported, skipped, removed };
  } catch (e) {
    if (e instanceof LedraLinkInactiveError) {
      // 所有者移転・店舗側での解除など。以後は取得しない
      await admin
        .from('ledra_links')
        .update({ status: 'revoked_by_provider', revoked_at: new Date().toISOString(), last_error: null })
        .eq('id', link.id);
      return { status: 'inactive' };
    }
    const message = e instanceof Error ? e.message : String(e);
    await admin.from('ledra_links').update({ last_error: message.slice(0, 500) }).eq('id', link.id);
    return { status: 'error', message };
  }
}

/** 解除の通知が Ledra に届かなかった連携。定期実行で再送する */
export const REVOKE_NOTIFY_FAILED = 'revoke_notify_failed';

export async function notifyRevoke(admin: SupabaseClient, ledra: LedraClient, link: Pick<LedraLinkRow, 'id' | 'ledra_link_id'>) {
  try {
    await ledra.revokeLink(link.ledra_link_id);
    await admin.from('ledra_links').update({ last_error: null }).eq('id', link.id);
    return true;
  } catch (e) {
    console.error(e);
    await admin.from('ledra_links').update({ last_error: REVOKE_NOTIFY_FAILED }).eq('id', link.id);
    return false;
  }
}
