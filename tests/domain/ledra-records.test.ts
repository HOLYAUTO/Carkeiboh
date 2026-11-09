import { describe, expect, it } from 'vitest';
import { ACCEPTED_CONSENTS, CONSENT_VERSION, extractLinkToken, toOilChangeInsert, toServiceExpenseInsert, toServiceRecord, toWearCheckInsert, voidedRecordId } from '../../supabase/functions/_shared/ledra-records.ts';

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

describe('取り消された記録', () => {
  it('voided: true の記録は取り込まず、記録IDを削除の対象として返す', () => {
    const raw = { record_id: 'rec_9', work_date: '2026-10-01', odo_km: 1000, oil_changed: true, filter_changed: false, shop_name: 'x', voided: true };
    expect(toOilChangeInsert(raw, link)).toBeNull();
    expect(voidedRecordId(raw)).toBe('rec_9');
  });

  it('通常の記録は削除の対象にしない', () => {
    expect(voidedRecordId({ record_id: 'rec_1', voided: false })).toBeNull();
    expect(voidedRecordId({ record_id: 'rec_1' })).toBeNull();
    expect(voidedRecordId(null)).toBeNull();
  });

  it('ODO の無い記録は取り込まない', () => {
    expect(toOilChangeInsert({ record_id: 'r', work_date: '2026-10-01', odo_km: null, oil_changed: true, voided: false }, link)).toBeNull();
  });
});

describe('QR からトークンを取り出す', () => {
  const token = 'abcDEF123_-.~abcdefgh';
  it('Ledra のトークン（lct_ + 43文字）を読める', () => {
    const ledra = 'lct_' + 'aB3_-'.repeat(8) + 'xyz';
    expect(ledra).toHaveLength(47);
    expect(extractLinkToken(ledra)).toBe(ledra);
  });

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

describe('タイヤ・ブレーキの記録の取り込み', () => {
  it('受け取る項目だけを取り込む。残り mm は小数1桁、範囲外の mm は捨てて記録は残す', () => {
    expect(
      toWearCheckInsert(
        { record_id: 'i1', kind: 'tire', work_date: '2026-10-31', odo_km: null, replaced: false, remaining_mm: 4.25, shop_name: ' 本店 ', notes: '社内メモ' },
        link,
      ),
    ).toEqual({
      vehicle_id: 'veh-1',
      user_id: 'user-1',
      kind: 'tire',
      performed_on: '2026-10-31',
      odo_km: null,
      replaced: false,
      remaining_mm: 4.3,
      source: 'ledra',
      ledra_link_id: 'link-1',
      ledra_record_id: 'i1',
      shop_name: '本店',
    });
    expect(toWearCheckInsert({ record_id: 'i1', kind: 'brake', work_date: '2026-10-31', remaining_mm: 31 }, link)?.remaining_mm).toBeNull();
  });

  it('種類・日付・記録IDが不正なもの、取り消されたものは取り込まない', () => {
    expect(toWearCheckInsert({ record_id: 'i1', kind: 'oil', work_date: '2026-10-31' }, link)).toBeNull();
    expect(toWearCheckInsert({ record_id: 'i1', kind: 'tire', work_date: 'x' }, link)).toBeNull();
    expect(toWearCheckInsert({ record_id: '', kind: 'tire', work_date: '2026-10-31' }, link)).toBeNull();
    expect(toWearCheckInsert({ record_id: 'i1', kind: 'tire', work_date: '2026-10-31', voided: true }, link)).toBeNull();
  });
});

describe('toServiceRecord / toServiceExpenseInsert（整備・車検の金額）', () => {
  const link = { id: 'link-1', vehicle_id: 'veh-1', user_id: 'user-1' };
  it('受け取る項目だけを読み、法定費用は車検だけ・合計以下だけ', () => {
    const rec = toServiceRecord({
      record_id: 's1',
      kind: 'shaken',
      work_date: '2026-11-20T10:00:00+09:00',
      odo_km: 52300.4,
      title: '車検',
      total_yen: 98450,
      statutory_fees_yen: 32650,
      shop_name: '本店',
      owner_name: '受け取らない',
      voided: false,
    });
    expect(rec).toEqual({ recordId: 's1', kind: 'shaken', workDate: '2026-11-20', odoKm: 52300, title: '車検', totalYen: 98450, statutoryFeesYen: 32650, shopName: '本店' });
    expect(toServiceRecord({ record_id: 'm1', kind: 'maintenance', work_date: '2026-11-20', total_yen: 5000, statutory_fees_yen: 3000 })?.statutoryFeesYen).toBeNull();
    expect(toServiceRecord({ record_id: 's2', kind: 'shaken', work_date: '2026-11-20', total_yen: 5000, statutory_fees_yen: 9000 })?.statutoryFeesYen).toBeNull();
  });
  it('金額の無い記録・知らない種類・取り消しは取り込まない', () => {
    expect(toServiceRecord({ record_id: 'x', kind: 'shaken', work_date: '2026-11-20', total_yen: 0 })).toBeNull();
    expect(toServiceRecord({ record_id: 'x', kind: 'car_wash', work_date: '2026-11-20', total_yen: 1000 })).toBeNull();
    expect(toServiceRecord({ record_id: 'x', kind: 'shaken', work_date: '2026-11-20', total_yen: 1000, voided: true })).toBeNull();
  });
  it('オイル交換は、そのオイル交換の記録が無ければまだ入れない', () => {
    const rec = toServiceRecord({ record_id: 'c1', kind: 'oil_change', work_date: '2026-10-01', total_yen: 5500, title: 'オイル交換', shop_name: '本店' })!;
    expect(toServiceExpenseInsert(rec, link, null)).toBeNull();
    expect(toServiceExpenseInsert(rec, link, 'oil-1')).toMatchObject({ category: 'oil_change', oil_change_id: 'oil-1', note: 'オイル交換・本店', source: 'ledra', ledra_record_id: 'c1' });
  });
});

describe('ACCEPTED_CONSENTS（同意の版）', () => {
  it('今の版と、更新前のアプリから届く1つ前の版を受け付け、前の版には整備・車検を含めない', () => {
    expect(ACCEPTED_CONSENTS[CONSENT_VERSION]).toContain('整備・車検の内容と金額');
    expect(ACCEPTED_CONSENTS['2026-10-31.1']).not.toContain('整備・車検の内容と金額');
    expect(ACCEPTED_CONSENTS['2026-10-31.1']).toContain('タイヤの溝の深さ');
    expect(ACCEPTED_CONSENTS['2026-10-23.1']).toBeUndefined();
  });
});
