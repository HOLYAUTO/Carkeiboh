import { LedraLinkInactiveError, LedraNotConsentedError, type LedraClient, type RecordsPage } from './ledra-client.ts';
import { toOilChangeInsert, toWearCheckInsert, voidedRecordId } from './ledra-records.ts';
import type { SupabaseClient } from './supabase.ts';

export interface LedraLinkRow {
  id: string;
  vehicle_id: string;
  user_id: string;
  ledra_link_id: string;
  status: 'active' | 'revoked_by_user' | 'revoked_by_provider';
  sync_cursor: string | null;
  wear_sync_cursor: string | null;
  last_error: string | null;
}

/** 取り込む列（定期取得・連携の確定で同じものを読む） */
export const LEDRA_LINK_COLUMNS = 'id, vehicle_id, user_id, ledra_link_id, status, sync_cursor, wear_sync_cursor, last_error';

/** 1回の取得で読むページ数の上限（暴走防止。残りは次の回に取得する） */
const MAX_PAGES = 20;

export type SyncResult =
  | { status: 'ok'; imported: number; skipped: number; removed: number }
  | { status: 'inactive' }
  | { status: 'error'; message: string };

type Counts = { imported: number; skipped: number; removed: number };

/** 記録の種類ごとの違い（取得先・保存先・差分の位置の列） */
interface Stream {
  fetch: (linkId: string, cursor: string | null) => Promise<RecordsPage>;
  table: 'oil_changes' | 'wear_checks';
  onConflict: string;
  cursorColumn: 'sync_cursor' | 'wear_sync_cursor';
  toInsert: (raw: unknown, link: LedraLinkRow) => object | null;
  /** 取消を種類（kind）ごとに消す。1回の点検からタイヤとブレーキが同じ記録IDで来るため、片方の取消でもう片方を消さない */
  voidByKind?: boolean;
}

async function pull(admin: SupabaseClient, link: LedraLinkRow, stream: Stream, counts: Counts) {
  let cursor = link[stream.cursorColumn];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { records, nextCursor, hasMore } = await stream.fetch(link.ledra_link_id, cursor);
    // 整備工場が取り消した記録は消す（オイル交換に紐づく金額の支出も外部キーの連鎖で消える）
    const groups = new Map<string | null, string[]>();
    for (const r of records) {
      const id = voidedRecordId(r);
      if (id === null) continue;
      const kind = stream.voidByKind ? String((r as { kind?: unknown }).kind) : null;
      groups.set(kind, [...(groups.get(kind) ?? []), id]);
    }
    for (const [kind, ids] of groups) {
      let q = admin.from(stream.table).delete().eq('vehicle_id', link.vehicle_id).eq('source', 'ledra');
      if (kind !== null) q = q.eq('kind', kind);
      const { data: gone, error } = await q.in('ledra_record_id', ids).select('id');
      if (error) throw new Error(`取り消された記録の削除に失敗しました: ${error.message}`);
      counts.removed += gone?.length ?? 0;
    }
    const live = records.filter((r) => voidedRecordId(r) === null);
    const rows = live.map((r) => stream.toInsert(r, link));
    const valid = rows.filter((r) => r !== null);
    counts.skipped += rows.length - valid.length;
    if (valid.length > 0) {
      // Ledra 側で訂正された記録は上書きする（記録IDで重複させない）
      const { error } = await admin.from(stream.table).upsert(valid, { onConflict: stream.onConflict });
      if (error) throw new Error(`記録の保存に失敗しました: ${error.message}`);
      counts.imported += valid.length;
    }
    cursor = nextCursor;
    // 取り込みが済んだところまで、ページごとに位置を進める
    await admin
      .from('ledra_links')
      .update({ [stream.cursorColumn]: cursor, last_synced_at: new Date().toISOString(), last_error: null })
      .eq('id', link.id);
    if (!hasMore) break;
  }
}

/** 前回取得以降の差分を取り込む（オイル交換 → タイヤ・ブレーキの順） */
export async function syncLink(admin: SupabaseClient, ledra: LedraClient, link: LedraLinkRow): Promise<SyncResult> {
  const counts: Counts = { imported: 0, skipped: 0, removed: 0 };
  try {
    await pull(admin, link, {
      fetch: (id, c) => ledra.fetchOilRecords(id, c),
      table: 'oil_changes',
      onConflict: 'vehicle_id,ledra_record_id',
      cursorColumn: 'sync_cursor',
      toInsert: toOilChangeInsert,
    }, counts);
    try {
      await pull(admin, link, {
        fetch: (id, c) => ledra.fetchWearRecords(id, c),
        table: 'wear_checks',
        onConflict: 'vehicle_id,kind,ledra_record_id',
        cursorColumn: 'wear_sync_cursor',
        toInsert: toWearCheckInsert,
        voidByKind: true,
      }, counts);
    } catch (e) {
      // オイル交換だけに同意した連携（2026-10-31 より前の同意）、または鍵に passport:wear_records が無い。
      // 連携は止めずにタイヤ・ブレーキだけ飛ばす。鍵の設定漏れに気づけるようログには残す
      if (!(e instanceof LedraNotConsentedError)) throw e;
      console.warn(`ledra link ${link.id}: タイヤ・ブレーキの記録は 403（同意の範囲外か、鍵に passport:wear_records が無い）`);
    }
    if (counts.skipped > 0) console.warn(`ledra link ${link.id}: 不正な記録 ${counts.skipped} 件を取り込みませんでした`);
    return { status: 'ok', ...counts };
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
