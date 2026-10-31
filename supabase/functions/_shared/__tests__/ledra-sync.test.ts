import { describe, expect, it } from 'vitest';
import { LedraLinkInactiveError, LedraNotConsentedError, type LedraClient } from '../ledra-client.ts';
import { syncLink, type LedraLinkRow } from '../ledra-sync.ts';
import type { SupabaseClient } from '../supabase.ts';

/** 書き込みを記録するだけの Supabase（upsert・update の中身を確かめる） */
function fakeAdmin() {
  const calls: { table: string; op: string; value: unknown }[] = [];
  const chain = (table: string, op: string, value: unknown) => {
    calls.push({ table, op, value });
    const c: Record<string, unknown> = {};
    for (const m of ['eq', 'in']) c[m] = () => c;
    c.select = () => Promise.resolve({ data: [], error: null });
    c.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
    return c;
  };
  const admin = {
    from: (table: string) => ({
      upsert: (value: unknown) => chain(table, 'upsert', value),
      update: (value: unknown) => chain(table, 'update', value),
      delete: () => chain(table, 'delete', null),
    }),
  } as unknown as SupabaseClient;
  return { admin, calls };
}

const link: LedraLinkRow = {
  id: 'link-1',
  vehicle_id: 'veh-1',
  user_id: 'user-1',
  ledra_link_id: 'lnk',
  status: 'active',
  sync_cursor: null,
  wear_sync_cursor: null,
  last_error: null,
};

const oil = { record_id: 'c1', work_date: '2026-10-01', odo_km: 41000, oil_changed: true, filter_changed: false, shop_name: '本店', voided: false };
const tire = { record_id: 'i1', kind: 'tire', work_date: '2026-10-31', odo_km: null, replaced: false, remaining_mm: 4.5, shop_name: '本店', voided: false };

function ledra(wear: () => Promise<{ records: unknown[]; nextCursor: string | null; hasMore: boolean }>): LedraClient {
  return {
    previewToken: async () => ({ shopName: '本店' }) as never,
    confirmLink: async () => ({ linkId: 'lnk', shopName: null }),
    fetchOilRecords: async () => ({ records: [oil], nextCursor: 'oc1', hasMore: false }),
    fetchWearRecords: wear,
    revokeLink: async () => {},
  };
}

describe('Ledra の差分の取り込み', () => {
  it('オイル交換とタイヤ・ブレーキを、それぞれの差分の位置で取り込む', async () => {
    const { admin, calls } = fakeAdmin();
    const r = await syncLink(admin, ledra(async () => ({ records: [tire], nextCursor: 'wc1', hasMore: false })), link);
    expect(r).toEqual({ status: 'ok', imported: 2, skipped: 0, removed: 0 });
    expect(calls.filter((c) => c.op === 'upsert').map((c) => c.table)).toEqual(['oil_changes', 'wear_checks']);
    const cursors = calls.filter((c) => c.table === 'ledra_links').map((c) => c.value as Record<string, unknown>);
    expect(cursors[0]).toMatchObject({ sync_cursor: 'oc1' });
    expect(cursors[1]).toMatchObject({ wear_sync_cursor: 'wc1' });
    expect(cursors[1]).not.toHaveProperty('sync_cursor');
  });

  it('オイル交換だけに同意した連携（403）は、タイヤ・ブレーキを飛ばして連携を止めない', async () => {
    const { admin, calls } = fakeAdmin();
    const r = await syncLink(admin, ledra(async () => { throw new LedraNotConsentedError('HTTP 403'); }), link);
    expect(r).toEqual({ status: 'ok', imported: 1, skipped: 0, removed: 0 });
    expect(calls.some((c) => c.table === 'ledra_links' && (c.value as { status?: string })?.status === 'revoked_by_provider')).toBe(false);
  });

  it('タイヤ・ブレーキの取得で連携が無効と分かったら、連携を止める', async () => {
    const { admin, calls } = fakeAdmin();
    const r = await syncLink(admin, ledra(async () => { throw new LedraLinkInactiveError('HTTP 410'); }), link);
    expect(r).toEqual({ status: 'inactive' });
    expect(calls.some((c) => (c.value as { status?: string })?.status === 'revoked_by_provider')).toBe(true);
  });
});
