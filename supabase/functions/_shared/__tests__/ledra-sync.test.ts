import { describe, expect, it } from 'vitest';
import { LedraLinkInactiveError, LedraNotConsentedError, type LedraClient } from '../ledra-client.ts';
import { syncLink, type LedraLinkRow } from '../ledra-sync.ts';
import type { SupabaseClient } from '../supabase.ts';

/** 書き込みを記録するだけの Supabase（upsert・update の中身を確かめる） */
function fakeAdmin(selectData: Record<string, unknown[]> = {}) {
  const calls: { table: string; op: string; value: unknown }[] = [];
  const chain = (table: string, op: string, value: unknown) => {
    calls.push({ table, op, value });
    const c: Record<string, unknown> = {};
    for (const m of ['eq', 'in']) c[m] = (col: string, v: unknown) => {
      calls.push({ table, op: m, value: [col, v] });
      return c;
    };
    c.select = () => Promise.resolve({ data: [], error: null });
    c.then = (resolve: (v: unknown) => void) => resolve({ data: op === 'select' ? (selectData[table] ?? []) : null, error: null });
    return c;
  };
  const admin = {
    from: (table: string) => ({
      upsert: (value: unknown) => chain(table, 'upsert', value),
      update: (value: unknown) => chain(table, 'update', value),
      delete: () => chain(table, 'delete', null),
      select: (cols: unknown) => chain(table, 'select', cols),
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

type Page = { records: unknown[]; nextCursor: string | null; hasMore: boolean };
const notConsented = async (): Promise<Page> => {
  throw new LedraNotConsentedError('HTTP 404');
};

function ledra(wear: () => Promise<Page>, services: () => Promise<Page> = notConsented): LedraClient {
  return {
    previewToken: async () => ({ shopName: '本店' }) as never,
    confirmLink: async () => ({ linkId: 'lnk', shopName: null }),
    fetchOilRecords: async () => ({ records: [oil], nextCursor: 'oc1', hasMore: false }),
    fetchWearRecords: wear,
    fetchServiceRecords: services,
    revokeLink: async () => {},
  };
}

describe('Ledra の差分の取り込み', () => {
  it('オイル交換とタイヤ・ブレーキを、それぞれの差分の位置で取り込む', async () => {
    const { admin, calls } = fakeAdmin();
    const r = await syncLink(admin, ledra(async () => ({ records: [tire], nextCursor: 'wc1', hasMore: false })), link);
    expect(r).toEqual({ status: 'ok', imported: 2, skipped: 0, removed: 0 });
    expect(calls.filter((c) => c.op === 'upsert').map((c) => c.table)).toEqual(['oil_changes', 'wear_checks']);
    const cursors = calls.filter((c) => c.table === 'ledra_links' && c.op === 'update').map((c) => c.value as Record<string, unknown>);
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

  it('ブレーキの取消で、同じ点検のタイヤの記録は消さない（種類ごとに消す）', async () => {
    const { admin, calls } = fakeAdmin();
    const brakeVoid = { ...tire, kind: 'brake', remaining_mm: null, voided: true };
    await syncLink(admin, ledra(async () => ({ records: [tire, brakeVoid], nextCursor: 'wc1', hasMore: false })), link);
    const i = calls.findIndex((c) => c.table === 'wear_checks' && c.op === 'delete');
    expect(i).toBeGreaterThan(-1);
    expect(calls.slice(i, i + 5)).toContainEqual({ table: 'wear_checks', op: 'eq', value: ['kind', 'brake'] });
  });
});

describe('ledra-client のタイヤ・ブレーキ取得', () => {
  it('404（Ledra に API がまだ無い）でも連携を止めない扱いにする', async () => {
    const { ledraClientFromEnv } = await import('../ledra-client.ts');
    const g = globalThis as unknown as { Deno?: unknown; fetch: typeof fetch };
    const savedFetch = g.fetch;
    g.Deno = { env: { get: (k: string) => ({ LEDRA_API_BASE_URL: 'https://ledra.test/api', LEDRA_API_KEY: 'k' })[k] } };
    try {
      for (const [status, error] of [[404, LedraNotConsentedError], [403, LedraNotConsentedError], [410, LedraLinkInactiveError]] as const) {
        g.fetch = (async () => new Response('', { status })) as typeof fetch;
        await expect(ledraClientFromEnv().fetchWearRecords('lnk', null)).rejects.toBeInstanceOf(error);
      }
    } finally {
      g.fetch = savedFetch;
      delete g.Deno;
    }
  });
});

describe('整備・車検の金額の取り込み（6章）', () => {
  const shaken = { record_id: 's1', kind: 'shaken', work_date: '2026-11-20', odo_km: 52300, title: '車検', total_yen: 98450, statutory_fees_yen: 32650, shop_name: '本店', voided: false };
  const oilAmount = { record_id: 'c1', kind: 'oil_change', work_date: '2026-10-01', odo_km: 41000, title: 'オイル交換', total_yen: 5500, statutory_fees_yen: null, shop_name: '本店', voided: false };

  it('車検は支出に、オイル交換の金額は同じ記録IDのオイル交換に紐づけて入れ、位置を進める', async () => {
    const { admin, calls } = fakeAdmin({ oil_changes: [{ id: 'oil-row-1', ledra_record_id: 'c1' }] });
    const r = await syncLink(
      admin,
      ledra(notConsented, async () => ({ records: [shaken, oilAmount], nextCursor: 'sc1', hasMore: false })),
      link,
    );
    expect(r).toEqual({ status: 'ok', imported: 3, skipped: 0, removed: 0 });
    const ups = calls.filter((c) => c.op === 'upsert' && c.table === 'expenses').map((c) => c.value as Record<string, unknown>[]);
    expect(ups[0][0]).toMatchObject({ category: 'shaken', amount_yen: 98450, exempt_yen: 32650, source: 'ledra', ledra_record_id: 's1', oil_change_id: null });
    expect(ups[1][0]).toMatchObject({ category: 'oil_change', amount_yen: 5500, oil_change_id: 'oil-row-1', ledra_record_id: 'c1' });
    const cursors = calls.filter((c) => c.table === 'ledra_links' && c.op === 'update').map((c) => c.value as Record<string, unknown>);
    expect(cursors.some((v) => v.service_sync_cursor === 'sc1')).toBe(true);
  });

  it('オイル交換の記録がまだ無い金額があれば、位置を進めずに次の回に読み直す', async () => {
    const { admin, calls } = fakeAdmin({ oil_changes: [] });
    await syncLink(admin, ledra(notConsented, async () => ({ records: [oilAmount], nextCursor: 'sc1', hasMore: false })), link);
    const cursors = calls.filter((c) => c.table === 'ledra_links' && c.op === 'update').map((c) => c.value as Record<string, unknown>);
    expect(cursors.some((v) => 'service_sync_cursor' in v)).toBe(false);
  });

  it('同意していない連携（403・404）は、連携を止めずに飛ばす', async () => {
    const { admin } = fakeAdmin();
    const r = await syncLink(admin, ledra(notConsented, notConsented), link);
    expect(r.status).toBe('ok');
  });
});

