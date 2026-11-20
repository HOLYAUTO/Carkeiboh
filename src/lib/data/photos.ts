/** 愛車の写真（Storage の vehicle-photos） */
import { useQuery } from '@tanstack/react-query';
import { base64ToBytes } from '../db';
import { supabase } from '../supabase';
import type { VehicleRow } from './rows';
import { updateVehicle } from './vehicles';

const PHOTO_BUCKET = 'vehicle-photos';
/** 表示用の期限付き URL の有効期間。期限より少し早めに取り直す */
const PHOTO_URL_TTL_SECONDS = 60 * 60;

/** 写真の表示用 URL。差し替えるとパスが変わるので、パスごとに覚えておく */
export function useVehiclePhotoUrl(path: string | null) {
  return useQuery({
    queryKey: ['vehiclePhoto', path],
    enabled: !!path,
    staleTime: (PHOTO_URL_TTL_SECONDS - 10 * 60) * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path!, PHOTO_URL_TTL_SECONDS);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
  });
}

async function removePhotoFile(path: string) {
  // 消せなくても利用者の操作は止めない（他人からは読めないフォルダに残るだけ）
  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([path]);
  if (error) console.warn('写真の削除に失敗しました', error.message);
}

/**
 * 写真を差し替える。毎回新しいファイル名で置き、車両の行を書き換えてから古い写真を消す
 * （同じ名前で上書きすると、配信のキャッシュで古い写真が出ることがあるため）
 */
export async function saveVehiclePhoto(vehicle: Pick<VehicleRow, 'id' | 'user_id' | 'photo_path'>, jpegBase64: string) {
  const path = `${vehicle.user_id}/${vehicle.id}-${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, base64ToBytes(jpegBase64), { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  try {
    await updateVehicle(vehicle.id, { photo_path: path, photo_updated_at: new Date().toISOString() });
  } catch (e) {
    await removePhotoFile(path);
    throw e;
  }
  if (vehicle.photo_path) await removePhotoFile(vehicle.photo_path);
}

export async function removeVehiclePhoto(vehicle: Pick<VehicleRow, 'id' | 'photo_path'>) {
  await updateVehicle(vehicle.id, { photo_path: null, photo_updated_at: null });
  if (vehicle.photo_path) await removePhotoFile(vehicle.photo_path);
}
