import { describe, expect, it } from 'vitest';
import { sanitizeCertificateDraft } from '../../supabase/functions/_shared/certificate-draft.ts';

describe('sanitizeCertificateDraft（車検証の写真の読み取り結果）', () => {
  it('文言から区分を出し、読めた項目だけを返す', () => {
    const d = sanitizeCertificateDraft(
      {
        registration_number: 'なにわ 300 あ 12-34',
        first_registered_on: '2020-06',
        expires_on: '2027-06-30',
        kind_text: '普通',
        usage_text: '乗用',
        business_text: '自家用',
        fuel_text: 'ガソリン・電気',
        displacement_cc: 1496,
        vehicle_weight_kg: '1,310',
        gross_weight_kg: 1585,
        owner_name: '山田太郎',
        body_shape: '-',
        max_load_kg: null,
      },
      '2026-11-08',
    );
    expect(d).toEqual({
      registrationNumber: 'なにわ 300 あ 12-34',
      firstRegisteredOn: '2020-06-01',
      expiresOn: '2027-06-30',
      kindText: '普通',
      vehicleClass: 'standard',
      usage: 'passenger',
      businessClass: 'private',
      powertrain: 'hybrid',
      displacementCc: 1496,
      vehicleWeightKg: 1310,
      grossWeightKg: 1585,
      ownerName: '山田太郎',
    });
  });
  it('ありえない日付・数字・未来の初度登録は捨てる', () => {
    const d = sanitizeCertificateDraft(
      { expires_on: '2027-02-30', first_registered_on: '2030-01', displacement_cc: 0, seating_capacity: 2.5 },
      '2026-11-08',
    );
    expect(d).toEqual({});
  });
});
