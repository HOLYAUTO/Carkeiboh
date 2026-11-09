/**
 * 車検証（自動車検査証）の記載内容。
 * - 車検証の文言（「普通」「乗用」「自家用」「ガソリン」など）やナンバーの分類番号から、税の計算に使う区分を判別する
 * - 所有者・使用者の氏名・住所、使用の本拠の位置は個人情報なので、見せるときは伏せる
 * - 使用の本拠の位置（なければ使用者の住所）から都道府県を出す（県ごとの自動車税に使う）
 */
import type { IsoDate } from './dates.ts';
import type { Powertrain, VehicleClass } from './vehicle-tax.ts';

export const VEHICLE_USAGES = ['passenger', 'cargo', 'bus', 'special'] as const;
/** 用途：乗用・貨物・乗合（バス）・特種（キャンピング車など） */
export type VehicleUsage = (typeof VEHICLE_USAGES)[number];
export const VEHICLE_USAGE_LABELS: Record<VehicleUsage, string> = { passenger: '乗用', cargo: '貨物', bus: '乗合', special: '特種' };

export const BUSINESS_CLASSES = ['private', 'commercial'] as const;
/** 自家用・事業用（営業用）の別 */
export type BusinessClass = (typeof BUSINESS_CLASSES)[number];
export const BUSINESS_CLASS_LABELS: Record<BusinessClass, string> = { private: '自家用', commercial: '事業用' };

/** 車検証の記載内容（税の計算に使う項目と、それ以外のすべて） */
export interface VehicleCertificate {
  registrationNumber: string | null;
  registeredOn: IsoDate | null;
  firstRegisteredOn: IsoDate | null;
  expiresOn: IsoDate | null;
  kindText: string | null;
  vehicleClass: VehicleClass | null;
  usage: VehicleUsage | null;
  businessClass: BusinessClass | null;
  bodyShape: string | null;
  maker: string | null;
  modelCode: string | null;
  chassisNumber: string | null;
  engineModel: string | null;
  displacementCc: number | null;
  powertrain: Powertrain | null;
  seatingCapacity: number | null;
  maxLoadKg: number | null;
  vehicleWeightKg: number | null;
  grossWeightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  axleFfKg: number | null;
  axleFrKg: number | null;
  axleRfKg: number | null;
  axleRrKg: number | null;
  typeDesignationNumber: string | null;
  categoryNumber: string | null;
  ownerName: string | null;
  ownerAddress: string | null;
  userName: string | null;
  userAddress: string | null;
  baseLocation: string | null;
  remarks: string | null;
}

export const EMPTY_CERTIFICATE: VehicleCertificate = {
  registrationNumber: null,
  registeredOn: null,
  firstRegisteredOn: null,
  expiresOn: null,
  kindText: null,
  vehicleClass: null,
  usage: null,
  businessClass: null,
  bodyShape: null,
  maker: null,
  modelCode: null,
  chassisNumber: null,
  engineModel: null,
  displacementCc: null,
  powertrain: null,
  seatingCapacity: null,
  maxLoadKg: null,
  vehicleWeightKg: null,
  grossWeightKg: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  axleFfKg: null,
  axleFrKg: null,
  axleRfKg: null,
  axleRrKg: null,
  typeDesignationNumber: null,
  categoryNumber: null,
  ownerName: null,
  ownerAddress: null,
  userName: null,
  userAddress: null,
  baseLocation: null,
  remarks: null,
};

/** 個人情報として伏せる項目 */
export const PERSONAL_FIELDS = ['ownerName', 'ownerAddress', 'userName', 'userAddress', 'baseLocation'] as const;
export type PersonalField = (typeof PERSONAL_FIELDS)[number];

function norm(text: string | null | undefined): string {
  return (text ?? '').normalize('NFKC').replace(/\s/g, '');
}

/**
 * ナンバーの分類番号（「品川 300 あ」の 300 の先頭）から、種別・用途を出す。
 * 1=普通貨物、2=乗合、3=普通乗用、4・6=小型貨物、5・7=小型乗用、8=特種。軽は 4・6（貨物）、5・7（乗用）、8（特種）で、種別は分からない
 */
export function classifyPlate(registrationNumber: string | null): { vehicleClass: VehicleClass | null; usage: VehicleUsage | null } {
  const m = norm(registrationNumber).match(/(\d{1,3})[ぁ-んア-ン]/);
  if (!m) return { vehicleClass: null, usage: null };
  const head = m[1][0];
  const usage: VehicleUsage | null =
    head === '3' || head === '5' || head === '7' ? 'passenger' : head === '1' || head === '4' || head === '6' ? 'cargo' : head === '2' ? 'bus' : head === '8' ? 'special' : null;
  // 1・2・3 は普通車（登録車）だけにある
  const vehicleClass: VehicleClass | null = head === '1' || head === '2' || head === '3' ? 'standard' : null;
  return { vehicleClass, usage };
}

/** 車検証の「自動車の種別」の文言から。普通・小型は standard、軽は kei。大型特殊・小型特殊は対象外（null） */
export function parseVehicleClass(text: string | null): VehicleClass | null {
  const s = norm(text);
  if (!s || s.includes('特殊')) return null;
  if (s.includes('軽')) return 'kei';
  if (s.includes('普通') || s.includes('小型')) return 'standard';
  return null;
}

/** 車検証の「用途」の文言から */
export function parseUsage(text: string | null): VehicleUsage | null {
  const s = norm(text);
  if (s.includes('乗合')) return 'bus';
  if (s.includes('特種') || s.includes('特殊用途')) return 'special';
  if (s.includes('貨物')) return 'cargo';
  if (s.includes('乗用')) return 'passenger';
  return null;
}

/** 車検証の「自家用・事業用の別」の文言から */
export function parseBusinessClass(text: string | null): BusinessClass | null {
  const s = norm(text);
  if (s.includes('事業') || s.includes('営業')) return 'commercial';
  if (s.includes('自家')) return 'private';
  return null;
}

/** 車検証の「燃料の種類」の文言から。「ガソリン・電気」などはハイブリッド */
export function parsePowertrain(text: string | null): Powertrain | null {
  const s = norm(text);
  if (!s) return null;
  const electric = s.includes('電気');
  const engine = s.includes('ガソリン') || s.includes('軽油') || s.includes('LPG') || s.includes('液化石油');
  if (electric && engine) return 'hybrid';
  if (electric || s.includes('水素') || s.includes('燃料電池')) return 'electric';
  if (s.includes('軽油')) return 'diesel';
  if (s.includes('ガソリン') || s.includes('LPG') || s.includes('液化石油')) return 'gasoline';
  return null;
}

/**
 * 種別・用途・自家用/事業用を、車検証の文言を優先して決める。文言が無ければナンバーの分類番号から。
 * 白・緑・黄・黒のナンバーの色は文字から分からないため、自家用/事業用はナンバーからは決めない
 */
export function classifyCertificate(input: {
  kindText: string | null;
  usageText: string | null;
  businessText: string | null;
  registrationNumber: string | null;
}): { vehicleClass: VehicleClass | null; usage: VehicleUsage | null; businessClass: BusinessClass | null } {
  const plate = classifyPlate(input.registrationNumber);
  return {
    vehicleClass: parseVehicleClass(input.kindText) ?? plate.vehicleClass,
    usage: parseUsage(input.usageText) ?? plate.usage,
    businessClass: parseBusinessClass(input.businessText),
  };
}

export const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
] as const;
export type Prefecture = (typeof PREFECTURES)[number];

/** 住所の先頭の都道府県。「都・道・府・県」が省かれていても読む（例：「大阪市…」は読めないので null） */
export function prefectureOf(address: string | null): Prefecture | null {
  const s = norm(address);
  if (!s) return null;
  for (const p of PREFECTURES) {
    if (s.startsWith(p)) return p;
  }
  for (const p of PREFECTURES) {
    const short = p === '北海道' ? p : p.slice(0, -1);
    if (s.startsWith(short)) return p;
  }
  return null;
}

/** 自動車税がかかる都道府県：使用の本拠の位置、なければ使用者の住所、なければ所有者の住所 */
export function taxPrefecture(c: Pick<VehicleCertificate, 'baseLocation' | 'userAddress' | 'ownerAddress'>): Prefecture | null {
  return prefectureOf(c.baseLocation) ?? prefectureOf(c.userAddress) ?? prefectureOf(c.ownerAddress);
}

const HIDDEN = '＊＊＊';

/** 住所は都道府県と市区町村までにして、残りを伏せる */
export function maskAddress(address: string | null): string | null {
  const s = (address ?? '').normalize('NFKC').trim();
  if (!s) return null;
  const m = s.match(/^(.+?[都道府県])?(.+?郡.+?[町村]|.+?市.+?区|.+?[市区町村])?/);
  const head = `${m?.[1] ?? ''}${m?.[2] ?? ''}`;
  return head ? `${head}${HIDDEN}` : HIDDEN;
}

/** 氏名・名称は伏せる（入っているかだけ分かるようにする） */
export function maskName(name: string | null): string | null {
  return (name ?? '').trim() ? `${HIDDEN}（登録済み）` : null;
}

/** 車台番号は末尾4文字だけ見せる */
export function maskChassisNumber(chassis: string | null): string | null {
  const s = (chassis ?? '').trim();
  if (!s) return null;
  return s.length <= 4 ? HIDDEN : `${HIDDEN}${s.slice(-4)}`;
}

/** 見せるための車検証。個人情報（氏名・住所・使用の本拠の位置）と車台番号を伏せる */
export function maskCertificate(c: VehicleCertificate): VehicleCertificate {
  return {
    ...c,
    ownerName: maskName(c.ownerName),
    userName: maskName(c.userName),
    ownerAddress: maskAddress(c.ownerAddress),
    userAddress: maskAddress(c.userAddress),
    baseLocation: maskAddress(c.baseLocation),
    chassisNumber: maskChassisNumber(c.chassisNumber),
  };
}
