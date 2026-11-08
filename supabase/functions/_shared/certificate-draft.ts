/**
 * 車検証の写真から読み取った値を、記録に入れられる形に整える（範囲外・形の違う値は捨てる）。
 * アプリには読み取れた項目だけを返し、アプリは今の入力に重ねる。
 */
import type { IsoDate } from './domain/dates.ts';
import { classifyCertificate, parsePowertrain, type VehicleCertificate } from './domain/vehicle-certificate.ts';

export type CertificateDraft = Partial<VehicleCertificate>;

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFKC').trim();
  return s && s !== '-' && s.length <= max ? s : null;
}

function int(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function isRealDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function date(v: unknown): IsoDate | null {
  const s = str(v, 20);
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) return null;
  return s!;
}

/** 'YYYY-MM' または 'YYYY-MM-DD' を月の1日にする */
function month(v: unknown): IsoDate | null {
  const s = str(v, 20);
  const m = s?.match(/^(\d{4})-(\d{2})(-\d{2})?$/);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

export function sanitizeCertificateDraft(raw: Record<string, unknown>, today: IsoDate): CertificateDraft {
  const registrationNumber = str(raw.registration_number, 40);
  const cls = classifyCertificate({
    kindText: str(raw.kind_text, 20),
    usageText: str(raw.usage_text, 20),
    businessText: str(raw.business_text, 20),
    registrationNumber,
  });
  const firstRegisteredOn = month(raw.first_registered_on);
  const registeredOn = date(raw.registered_on);
  const draft: CertificateDraft = {
    registrationNumber,
    registeredOn: registeredOn && registeredOn <= today ? registeredOn : null,
    firstRegisteredOn: firstRegisteredOn && firstRegisteredOn <= today ? firstRegisteredOn : null,
    expiresOn: date(raw.expires_on),
    kindText: str(raw.kind_text, 20),
    vehicleClass: cls.vehicleClass,
    usage: cls.usage,
    businessClass: cls.businessClass,
    bodyShape: str(raw.body_shape, 40),
    maker: str(raw.maker, 40),
    modelCode: str(raw.model_code, 40),
    chassisNumber: str(raw.chassis_number, 40),
    engineModel: str(raw.engine_model, 40),
    displacementCc: int(raw.displacement_cc, 1, 20000),
    powertrain: parsePowertrain(str(raw.fuel_text, 40)),
    seatingCapacity: int(raw.seating_capacity, 1, 100),
    maxLoadKg: int(raw.max_load_kg, 0, 100000),
    vehicleWeightKg: int(raw.vehicle_weight_kg, 1, 30000),
    grossWeightKg: int(raw.gross_weight_kg, 1, 100000),
    lengthCm: int(raw.length_cm, 1, 5000),
    widthCm: int(raw.width_cm, 1, 1000),
    heightCm: int(raw.height_cm, 1, 1000),
    axleFfKg: int(raw.axle_ff_kg, 0, 100000),
    axleFrKg: int(raw.axle_fr_kg, 0, 100000),
    axleRfKg: int(raw.axle_rf_kg, 0, 100000),
    axleRrKg: int(raw.axle_rr_kg, 0, 100000),
    typeDesignationNumber: str(raw.type_designation_number, 20),
    categoryNumber: str(raw.category_number, 20),
    ownerName: str(raw.owner_name, 100),
    ownerAddress: str(raw.owner_address, 200),
    userName: str(raw.user_name, 100),
    userAddress: str(raw.user_address, 200),
    baseLocation: str(raw.base_location, 200),
    remarks: str(raw.remarks, 500),
  };
  // 読み取れなかった項目は返さない（アプリの入力を消さないため）
  return Object.fromEntries(Object.entries(draft).filter(([, v]) => v != null)) as CertificateDraft;
}
