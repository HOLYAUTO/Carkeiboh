/** 車検証の読み書き。税の計算に使う項目は vehicles に、それ以外は vehicle_certificates に持つ */
import { useQuery } from '@tanstack/react-query';
import type { IsoDate } from '@domain/dates.ts';
import { EMPTY_CERTIFICATE, type VehicleCertificate } from '@domain/vehicle-certificate.ts';
import { unwrap } from '../db';
import { supabase } from '../supabase';
import type { VehicleRow } from './rows';
import { registerDeadline, updateVehicle } from './vehicles';

/** 車検証の項目のうち vehicles に持つもの（税の計算に使う）。それ以外は vehicle_certificates */
const CERTIFICATE_VEHICLE_FIELDS = [
  'firstRegisteredOn',
  'vehicleClass',
  'usage',
  'businessClass',
  'displacementCc',
  'powertrain',
  'seatingCapacity',
  'maxLoadKg',
  'vehicleWeightKg',
  'grossWeightKg',
] as const satisfies readonly (keyof VehicleCertificate)[];

const CERTIFICATE_TABLE_FIELDS = (Object.keys(EMPTY_CERTIFICATE) as (keyof VehicleCertificate)[]).filter(
  (k) => !(CERTIFICATE_VEHICLE_FIELDS as readonly string[]).includes(k),
);

/** registeredOn → registered_on、axleFfKg → axle_ff_kg */
function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function useVehicleCertificate(vehicle: VehicleRow | undefined) {
  return useQuery({
    queryKey: ['vehicle-certificate', vehicle?.user_id, vehicle?.id],
    enabled: !!vehicle,
    queryFn: async (): Promise<VehicleCertificate> => {
      const rows = unwrap(await supabase.from('vehicle_certificates').select('*').eq('vehicle_id', vehicle!.id)) as Record<string, unknown>[];
      const row = rows[0] ?? {};
      const v = vehicle as unknown as Record<string, unknown>;
      const cert = { ...EMPTY_CERTIFICATE } as Record<string, unknown>;
      for (const k of CERTIFICATE_TABLE_FIELDS) cert[k] = row[snake(k)] ?? null;
      for (const k of CERTIFICATE_VEHICLE_FIELDS) cert[k] = v[snake(k)] ?? null;
      return cert as unknown as VehicleCertificate;
    },
  });
}

/**
 * 車検証を保存する。
 * ナンバーが未登録なら車検証のナンバーを入れ、満了日が今の車検の期限と違えば期限も更新する
 */
export async function saveVehicleCertificate(vehicle: VehicleRow, cert: VehicleCertificate, currentShakenDueOn: IsoDate | null) {
  const certRow: Record<string, unknown> = { vehicle_id: vehicle.id };
  for (const k of CERTIFICATE_TABLE_FIELDS) certRow[snake(k)] = cert[k];
  unwrap(await supabase.from('vehicle_certificates').upsert(certRow, { onConflict: 'vehicle_id' }));
  const patch: Record<string, unknown> = {};
  for (const k of CERTIFICATE_VEHICLE_FIELDS) patch[snake(k)] = cert[k];
  if (!vehicle.plate_number && cert.registrationNumber) patch.plate_number = cert.registrationNumber.slice(0, 30);
  await updateVehicle(vehicle.id, patch as Partial<Omit<VehicleRow, 'id' | 'user_id'>>);
  if (cert.expiresOn && cert.expiresOn !== currentShakenDueOn) await registerDeadline(vehicle.id, 'shaken', cert.expiresOn);
}
