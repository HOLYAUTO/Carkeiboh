/** 位置と地図アプリまわりの計算（画面から切り離して試験できるよう、React Native に依存しない） */

export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371;

/** 2点間の直線距離（km）。道のりではないので「約」を付けて見せる */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 「約 850m」「約 3.2km」「約 25km」 */
export function formatDistance(km: number): string {
  if (km < 1) return `約 ${Math.max(100, Math.round((km * 1000) / 50) * 50).toLocaleString('ja-JP')}m`;
  if (km < 10) return `約 ${(Math.round(km * 10) / 10).toFixed(1)}km`;
  return `約 ${Math.round(km).toLocaleString('ja-JP')}km`;
}

/**
 * 近い順に並べる。現在地がなければ掲載の優先度 → 名前の順。
 * 距離が同じくらい（100m 未満の差）なら優先度の高い方を先にする
 */
export function sortByDistance<T extends LatLng & { name: string; display_priority: number }>(
  items: T[],
  origin: LatLng | null,
): (T & { distanceKm: number | null })[] {
  const withDistance = items.map((s) => ({ ...s, distanceKm: origin ? distanceKm(origin, s) : null }));
  return withDistance.sort((a, b) => {
    if (a.distanceKm != null && b.distanceKm != null && Math.abs(a.distanceKm - b.distanceKm) >= 0.1) return a.distanceKm - b.distanceKm;
    if (a.display_priority !== b.display_priority) return b.display_priority - a.display_priority;
    return a.name.localeCompare(b.name, 'ja');
  });
}

export type MapApp = 'apple' | 'google';

/**
 * 地図アプリで、現在地から目的地までの車のルートを開く URL。
 * どちらも https の URL なので、アプリが入っていればアプリで、なければブラウザで開く
 */
export function routeUrl(app: MapApp, to: LatLng, name: string): string {
  const dest = `${to.latitude},${to.longitude}`;
  if (app === 'apple') return `https://maps.apple.com/?daddr=${dest}&q=${encodeURIComponent(name)}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

/** 電話をかける URL。数字と + 以外は取り除く */
export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`;
}
