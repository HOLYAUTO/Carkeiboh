import { describe, expect, it } from 'vitest';
import { extractLinkToken, toOilChangeInsert } from '../../supabase/functions/_shared/ledra-records.ts';

const link = { id: 'link-1', vehicle_id: 'veh-1', user_id: 'user-1' };

describe('Ledra の記録の取り込み', () => {
  it('受け取る項目だけを取り込む（想定外の項目は捨てる）', () => {
    const row = toOilChangeInsert(
      {
        record_id: 'rec_1',
        work_date: '2026-10-01T10:00:00+09:00',
        odo_km: 41000.4,
        oil_changed: true,
        filter_changed: false,
        shop_name: ' たにぐち自動車 ',
        customer_name: '山田太郎',
        amount: 5500,
      },
      link,
    );
    expect(row).toEqual({
      vehicle_id: 'veh-1',
      user_id: 'user-1',
      performed_on: '2026-10-01',
      odo_km: 41000,
      oil_changed: true,
      filter_changed: false,
      source: 'ledra',
      ledra_link_id: 'link-1',
      ledra_record_id: 'rec_1',
      shop_name: 'たにぐち自動車',
    });
  });

  it('不正な記録・オイルもフィルターも交換していない記録は取り込まない', () => {
    expect(toOilChangeInsert({ record_id: 'r', work_date: '2026-13-01', odo_km: 1, oil_changed: true }, link)).toBeNull();
    expect(toOilChangeInsert({ record_id: 'r', work_date: '2026-10-01', odo_km: -1, oil_changed: true }, link)).toBeNull();
    expect(toOilChangeInsert({ record_id: '', work_date: '2026-10-01', odo_km: 1, oil_changed: true }, link)).toBeNull();
    expect(toOilChangeInsert({ record_id: 'r', work_date: '2026-10-01', odo_km: 1, oil_changed: false, filter_changed: false }, link)).toBeNull();
    expect(toOilChangeInsert(null, link)).toBeNull();
  });
});

describe('QR からトークンを取り出す', () => {
  const token = 'abcDEF123_-.~abcdefgh';
  it('トークンだけ・URL のどちらにも対応する', () => {
    expect(extractLinkToken(token)).toBe(token);
    expect(extractLinkToken(` ${token}\n`)).toBe(token);
    expect(extractLinkToken(`https://ledra.example/link?token=${token}`)).toBe(token);
  });
  it('連携用でない QR は受け付けない', () => {
    expect(extractLinkToken('https://example.com/')).toBeNull();
    expect(extractLinkToken('short')).toBeNull();
    expect(extractLinkToken('車台番号 ABC123-4567890')).toBeNull();
  });
});
