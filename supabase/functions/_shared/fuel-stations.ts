/**
 * ガソリンスタンドの場所（OpenStreetMap の amenity=fuel）の扱い。アプリとサーバーで共有する。
 * 現在地はサーバーに送らず、約5km四方の「区画」だけを送って、その区画のスタンドを受け取る。
 * 近いかどうかは端末の中で計算する。
 */

/** 区画の大きさ（緯度・経度の度）。0.05度は日本で約 5.5km × 4.5km */
export const TILE_DEGREES = 0.05;

/** 「ここにいる」とみなすスタンドまでの距離（m）。位置の誤差を見込んで少し広めにとる */
export const AT_STATION_METERS = 150;

/** 立ち寄ったとみなす滞在時間（分）。前を通っただけ・長い駐車は除く */
export const VISIT_MIN_MINUTES = 2;
export const VISIT_MAX_MINUTES = 60;

export interface FuelStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface Position {
  latitude: number;
  longitude: number;
}

/** 区画の名前（例：'714_2795'）。南西の角の 0.05度ごとの番号 */
export function tileOf(p: Position): string {
  return `${Math.floor(p.latitude / TILE_DEGREES)}_${Math.floor(p.longitude / TILE_DEGREES)}`;
}

export function isTileKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  const m = key.match(/^(-?\d{1,4})_(-?\d{1,4})$/);
  if (!m) return false;
  const lat = Number(m[1]) * TILE_DEGREES;
  const lon = Number(m[2]) * TILE_DEGREES;
  return lat >= -90 && lat < 90 && lon >= -180 && lon < 180;
}

/** 区画の範囲（南・西・北・東） */
export function tileBounds(key: string): { south: number; west: number; north: number; east: number } {
  const [a, b] = key.split('_').map(Number);
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return { south: r(a * TILE_DEGREES), west: r(b * TILE_DEGREES), north: r((a + 1) * TILE_DEGREES), east: r((b + 1) * TILE_DEGREES) };
}

/** 地点のまわり radiusM の四角に重なる区画（区画の境の近くなら隣の区画も）。重複なし */
export function tilesAround(p: Position, radiusM: number): string[] {
  const dLat = radiusM / 111_000;
  const dLon = radiusM / (111_000 * Math.max(0.1, Math.cos((p.latitude * Math.PI) / 180)));
  const keys = new Set<string>();
  for (const lat of [p.latitude - dLat, p.latitude + dLat]) {
    for (const lon of [p.longitude - dLon, p.longitude + dLon]) keys.add(tileOf({ latitude: lat, longitude: lon }));
  }
  // 半径が区画より大きいときは、間の区画も入れる
  const [a1, b1] = tileOf({ latitude: p.latitude - dLat, longitude: p.longitude - dLon }).split('_').map(Number);
  const [a2, b2] = tileOf({ latitude: p.latitude + dLat, longitude: p.longitude + dLon }).split('_').map(Number);
  for (let a = a1; a <= a2; a++) for (let b = b1; b <= b2; b++) keys.add(`${a}_${b}`);
  return [...keys];
}

/** 2点間の距離（m） */
export function distanceMeters(a: Position, b: Position): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** いまいるスタンド（AT_STATION_METERS 以内でいちばん近いもの）。位置の誤差が大きすぎるときは判定しない */
export function stationAt(p: Position & { accuracy?: number | null }, stations: FuelStation[]): FuelStation | null {
  if (p.accuracy != null && p.accuracy > 500) return null;
  let best: { s: FuelStation; d: number } | null = null;
  for (const s of stations) {
    const d = distanceMeters(p, s);
    if (d <= AT_STATION_METERS && (!best || d < best.d)) best = { s, d };
  }
  return best?.s ?? null;
}

/** 近い順に limit 件（ジオフェンスに登録する分。iOS は1つのアプリで20か所まで） */
export function nearestStations(p: Position, stations: FuelStation[], limit: number): FuelStation[] {
  return stations
    .map((s) => ({ s, d: distanceMeters(p, s) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, limit)
    .map((x) => x.s);
}

/** 入った時刻と出た時刻から、立ち寄った（給油したかもしれない）とみなすか */
export function isVisit(enteredAtMs: number, exitedAtMs: number): boolean {
  const minutes = (exitedAtMs - enteredAtMs) / 60_000;
  return minutes >= VISIT_MIN_MINUTES && minutes <= VISIT_MAX_MINUTES;
}

/** Overpass API の結果（node・way の center）をスタンドの一覧にする。名前が無ければブランド、どちらも無ければ「ガソリンスタンド」 */
export function parseOverpass(json: unknown): FuelStation[] {
  const elements = (json as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const out: FuelStation[] = [];
  for (const e of elements as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> }[]) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number' || typeof e.id !== 'number') continue;
    const tags = e.tags ?? {};
    const name = (tags['name:ja'] ?? tags.name ?? tags.brand ?? tags.operator ?? 'ガソリンスタンド').slice(0, 60);
    out.push({ id: `${e.type ?? 'node'}/${e.id}`, name, latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lon * 1e6) / 1e6 });
  }
  return out;
}

/**
 * スタンドを出たときに「給油しましたか？」を出すか。2〜60分いた・そのあいだに給油を記録していない・
 * 今日そのスタンドでまだ出していない、のすべてを満たすときだけ
 */
export function shouldNotifyVisit(input: {
  enteredAtMs: number | null;
  exitedAtMs: number;
  lastFuelSavedAtMs: number | null;
  alreadyNotifiedToday: boolean;
}): boolean {
  if (!input.enteredAtMs || !isVisit(input.enteredAtMs, input.exitedAtMs)) return false;
  if (input.lastFuelSavedAtMs && input.lastFuelSavedAtMs >= input.enteredAtMs) return false;
  return !input.alreadyNotifiedToday;
}
