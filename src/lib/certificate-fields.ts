/**
 * 車検証の画面に並べる項目（見出し・単位・入力の種類）と、表示・入力の文字への変換。
 */
import {
  BUSINESS_CLASS_LABELS,
  BUSINESS_CLASSES,
  VEHICLE_USAGE_LABELS,
  VEHICLE_USAGES,
  type VehicleCertificate,
} from '@domain/vehicle-certificate.ts';
import {
  parseYearMonth,
  parseYearMonthDay,
  POWERTRAIN_LABELS,
  POWERTRAINS,
  VEHICLE_CLASS_LABELS,
  VEHICLE_CLASSES,
} from '@domain/vehicle-tax.ts';

export type CertKey = keyof VehicleCertificate;

export type FieldSpec =
  | { key: CertKey; label: string; type: 'text'; max: number; multiline?: boolean }
  | { key: CertKey; label: string; type: 'int'; suffix: string; min: number; max: number }
  | { key: CertKey; label: string; type: 'date' | 'month' }
  | { key: CertKey; label: string; type: 'choice'; options: { value: string; label: string }[] };

const choice = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map((v) => ({ value: v, label: labels[v] }));

export const CERTIFICATE_SECTIONS: { title: string; personal?: boolean; fields: FieldSpec[] }[] = [
  {
    title: '登録',
    fields: [
      { key: 'registrationNumber', label: '自動車登録番号（ナンバー）', type: 'text', max: 40 },
      { key: 'registeredOn', label: '登録年月日（交付年月日）', type: 'date' },
      { key: 'firstRegisteredOn', label: '初度登録年月（軽は初度検査年月）', type: 'month' },
      { key: 'expiresOn', label: '有効期間の満了する日', type: 'date' },
    ],
  },
  {
    title: '区分',
    fields: [
      { key: 'vehicleClass', label: '自動車の種別', type: 'choice', options: choice(VEHICLE_CLASSES, VEHICLE_CLASS_LABELS) },
      { key: 'usage', label: '用途', type: 'choice', options: choice(VEHICLE_USAGES, VEHICLE_USAGE_LABELS) },
      { key: 'businessClass', label: '自家用・事業用の別', type: 'choice', options: choice(BUSINESS_CLASSES, BUSINESS_CLASS_LABELS) },
      { key: 'kindText', label: '種別（車検証の表記）', type: 'text', max: 20 },
      { key: 'bodyShape', label: '車体の形状', type: 'text', max: 40 },
    ],
  },
  {
    title: '車両',
    fields: [
      { key: 'maker', label: '車名', type: 'text', max: 40 },
      { key: 'modelCode', label: '型式', type: 'text', max: 40 },
      { key: 'chassisNumber', label: '車台番号', type: 'text', max: 40 },
      { key: 'typeDesignationNumber', label: '型式指定番号', type: 'text', max: 20 },
      { key: 'categoryNumber', label: '類別区分番号', type: 'text', max: 20 },
    ],
  },
  {
    title: '原動機',
    fields: [
      { key: 'engineModel', label: '原動機の型式', type: 'text', max: 40 },
      { key: 'displacementCc', label: '総排気量', type: 'int', suffix: 'cc', min: 1, max: 20000 },
      { key: 'powertrain', label: '燃料の種類', type: 'choice', options: choice(POWERTRAINS, POWERTRAIN_LABELS) },
    ],
  },
  {
    title: '大きさ・重さ',
    fields: [
      { key: 'seatingCapacity', label: '乗車定員', type: 'int', suffix: '人', min: 1, max: 100 },
      { key: 'maxLoadKg', label: '最大積載量', type: 'int', suffix: 'kg', min: 0, max: 100000 },
      { key: 'vehicleWeightKg', label: '車両重量', type: 'int', suffix: 'kg', min: 1, max: 30000 },
      { key: 'grossWeightKg', label: '車両総重量', type: 'int', suffix: 'kg', min: 1, max: 100000 },
      { key: 'lengthCm', label: '長さ', type: 'int', suffix: 'cm', min: 1, max: 5000 },
      { key: 'widthCm', label: '幅', type: 'int', suffix: 'cm', min: 1, max: 1000 },
      { key: 'heightCm', label: '高さ', type: 'int', suffix: 'cm', min: 1, max: 1000 },
      { key: 'axleFfKg', label: '前前軸重', type: 'int', suffix: 'kg', min: 0, max: 100000 },
      { key: 'axleFrKg', label: '前後軸重', type: 'int', suffix: 'kg', min: 0, max: 100000 },
      { key: 'axleRfKg', label: '後前軸重', type: 'int', suffix: 'kg', min: 0, max: 100000 },
      { key: 'axleRrKg', label: '後後軸重', type: 'int', suffix: 'kg', min: 0, max: 100000 },
    ],
  },
  {
    title: '所有者・使用者',
    personal: true,
    fields: [
      { key: 'ownerName', label: '所有者の氏名又は名称', type: 'text', max: 100 },
      { key: 'ownerAddress', label: '所有者の住所', type: 'text', max: 200 },
      { key: 'userName', label: '使用者の氏名又は名称', type: 'text', max: 100 },
      { key: 'userAddress', label: '使用者の住所', type: 'text', max: 200 },
      { key: 'baseLocation', label: '使用の本拠の位置', type: 'text', max: 200 },
    ],
  },
  { title: '備考', fields: [{ key: 'remarks', label: '備考', type: 'text', max: 500, multiline: true }] },
];

export const ALL_FIELDS: FieldSpec[] = CERTIFICATE_SECTIONS.flatMap((s) => s.fields);

/** 表示用の文字（未入力は「—」） */
export function displayValue(f: FieldSpec, value: unknown): string {
  if (value == null || value === '') return '—';
  switch (f.type) {
    case 'date': {
      const s = String(value);
      return `${Number(s.slice(0, 4))}年${Number(s.slice(5, 7))}月${Number(s.slice(8, 10))}日`;
    }
    case 'month': {
      const s = String(value);
      return `${Number(s.slice(0, 4))}年${Number(s.slice(5, 7))}月`;
    }
    case 'int':
      return `${Number(value).toLocaleString('ja-JP')}${f.suffix}`;
    case 'choice':
      return f.options.find((o) => o.value === value)?.label ?? String(value);
    default:
      return String(value);
  }
}

/** 入力欄の初めの文字 */
export function inputText(f: FieldSpec, value: unknown): string {
  if (value == null) return '';
  if (f.type === 'date') return displayValue(f, value);
  if (f.type === 'month') return displayValue(f, value);
  return String(value);
}

/** 入力欄の文字を値にする。空は null、読めなければ undefined（入力の誤り） */
export function parseInput(f: FieldSpec, text: string): unknown {
  const s = text.trim();
  if (!s) return null;
  switch (f.type) {
    case 'date':
      return parseYearMonthDay(s) ?? undefined;
    case 'month':
      return parseYearMonth(s) ?? undefined;
    case 'int': {
      const n = Number(s.normalize('NFKC').replace(/[,\s]/g, ''));
      return Number.isInteger(n) && n >= f.min && n <= f.max ? n : undefined;
    }
    case 'text':
      return s.length <= f.max ? s : undefined;
    default:
      return s;
  }
}

export function inputHint(f: FieldSpec): string | undefined {
  if (f.type === 'date') return '例：令和9年6月30日、2027/6/30（和暦のままで大丈夫です）';
  if (f.type === 'month') return '例：令和2年6月、2020/6';
  return undefined;
}
