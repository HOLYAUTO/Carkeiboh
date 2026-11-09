import { describe, expect, it } from 'vitest';
import {
  classifyCertificate,
  classifyPlate,
  EMPTY_CERTIFICATE,
  maskAddress,
  maskCertificate,
  maskChassisNumber,
  parseBusinessClass,
  parsePowertrain,
  parseUsage,
  parseVehicleClass,
  prefectureOf,
  taxPrefecture,
} from '../../supabase/functions/_shared/domain/vehicle-certificate.ts';

describe('車検証の文言からの判別', () => {
  it('種別', () => {
    expect(parseVehicleClass('普通')).toBe('standard');
    expect(parseVehicleClass('小型')).toBe('standard');
    expect(parseVehicleClass('軽自動車')).toBe('kei');
    expect(parseVehicleClass('大型特殊')).toBeNull();
  });
  it('用途', () => {
    expect(parseUsage('乗用')).toBe('passenger');
    expect(parseUsage('貨物')).toBe('cargo');
    expect(parseUsage('乗合')).toBe('bus');
    expect(parseUsage('特種')).toBe('special');
  });
  it('自家用・事業用', () => {
    expect(parseBusinessClass('自家用')).toBe('private');
    expect(parseBusinessClass('事業用')).toBe('commercial');
    expect(parseBusinessClass('')).toBeNull();
  });
  it('燃料', () => {
    expect(parsePowertrain('ガソリン')).toBe('gasoline');
    expect(parsePowertrain('軽油')).toBe('diesel');
    expect(parsePowertrain('ガソリン・電気')).toBe('hybrid');
    expect(parsePowertrain('電気')).toBe('electric');
    expect(parsePowertrain('圧縮水素')).toBe('electric');
  });
});

describe('ナンバーの分類番号', () => {
  it('3・5・7 は乗用、1・4・6 は貨物、2 は乗合、8 は特種', () => {
    expect(classifyPlate('品川 300 あ 12-34')).toEqual({ vehicleClass: 'standard', usage: 'passenger' });
    expect(classifyPlate('品川 500 さ 12-34')).toEqual({ vehicleClass: null, usage: 'passenger' });
    expect(classifyPlate('品川 400 さ 12-34')).toEqual({ vehicleClass: null, usage: 'cargo' });
    expect(classifyPlate('品川 100 あ 1')).toEqual({ vehicleClass: 'standard', usage: 'cargo' });
    expect(classifyPlate('品川 800 は 1')).toEqual({ vehicleClass: null, usage: 'special' });
    expect(classifyPlate('')).toEqual({ vehicleClass: null, usage: null });
  });
  it('車検証の文言を優先し、無ければナンバーで決める', () => {
    expect(classifyCertificate({ kindText: null, usageText: null, businessText: '事業用', registrationNumber: '品川 300 か 1' })).toEqual({
      vehicleClass: 'standard',
      usage: 'passenger',
      businessClass: 'commercial',
    });
    expect(classifyCertificate({ kindText: '軽自動車', usageText: '貨物', businessText: '自家用', registrationNumber: '品川 580 あ 1' })).toEqual({
      vehicleClass: 'kei',
      usage: 'cargo',
      businessClass: 'private',
    });
  });
});

describe('都道府県', () => {
  it('住所の先頭から読む（都道府県の字が省かれていても）', () => {
    expect(prefectureOf('東京都千代田区霞が関2-1-3')).toBe('東京都');
    expect(prefectureOf('京都府京都市')).toBe('京都府');
    expect(prefectureOf('神奈川横浜市')).toBe('神奈川県');
    expect(prefectureOf('北海道札幌市')).toBe('北海道');
    expect(prefectureOf('横浜市')).toBeNull();
  });
  it('使用の本拠の位置 → 使用者の住所 → 所有者の住所の順', () => {
    expect(taxPrefecture({ baseLocation: null, userAddress: '大阪府堺市', ownerAddress: '東京都港区' })).toBe('大阪府');
    expect(taxPrefecture({ baseLocation: '宮城県仙台市', userAddress: '大阪府堺市', ownerAddress: null })).toBe('宮城県');
  });
});

describe('個人情報を伏せる', () => {
  it('住所は市区町村まで', () => {
    expect(maskAddress('東京都千代田区霞が関2-1-3')).toBe('東京都千代田区＊＊＊');
    expect(maskAddress('神奈川県横浜市中区本町1-1')).toBe('神奈川県横浜市中区＊＊＊');
    expect(maskAddress('長野県北佐久郡軽井沢町長倉1')).toBe('長野県北佐久郡軽井沢町＊＊＊');
    expect(maskAddress('')).toBeNull();
  });
  it('車台番号は末尾4文字だけ', () => {
    expect(maskChassisNumber('ZVW50-1234567')).toBe('＊＊＊4567');
  });
  it('氏名は伏せ、税の計算に使う項目はそのまま', () => {
    const masked = maskCertificate({
      ...EMPTY_CERTIFICATE,
      ownerName: '山田太郎',
      userName: '株式会社たにぐち自動車',
      ownerAddress: '大阪府大阪市北区梅田1-1',
      displacementCc: 1496,
      registrationNumber: 'なにわ 300 あ 12-34',
    });
    expect(masked.ownerName).toBe('＊＊＊（登録済み）');
    expect(masked.userName).toBe('＊＊＊（登録済み）');
    expect(masked.ownerAddress).toBe('大阪府大阪市北区＊＊＊');
    expect(masked.displacementCc).toBe(1496);
    expect(masked.registrationNumber).toBe('なにわ 300 あ 12-34');
    expect(JSON.stringify(masked)).not.toContain('山田');
    expect(JSON.stringify(masked)).not.toContain('梅田');
  });
});
