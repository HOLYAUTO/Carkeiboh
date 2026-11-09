// ガソリンスタンドの場所を、区画（約5km四方）ごとに返す。OpenStreetMap（Overpass API）から取り、30日間ためる。
// 区画の名前だけを受け取り、利用者の正確な位置は受け取らない
import { isTileKey, parseOverpass, tileBounds, type FuelStation } from '../_shared/fuel-stations.ts';
import { handle, HttpError, json, readJson, requirePost } from '../_shared/http.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';

const MAX_TILES = 9;
const CACHE_DAYS = 30;
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

async function fetchTile(tile: string): Promise<FuelStation[]> {
  const b = tileBounds(tile);
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const query = `[out:json][timeout:20];(node["amenity"="fuel"](${bbox});way["amenity"="fuel"](${bbox}););out center tags;`;
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ijilog-fuel-stations/1.0' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new HttpError(502, 'stations_unavailable', 'ガソリンスタンドの場所を取れませんでした。');
  return parseOverpass(await res.json());
}

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    const admin = adminClient();
    await requireUser(req, admin);
    const { tiles } = await readJson<{ tiles: unknown }>(req);
    if (!Array.isArray(tiles) || tiles.length === 0 || tiles.length > MAX_TILES || !tiles.every(isTileKey)) {
      throw new HttpError(400, 'invalid_tiles', '区画の指定が正しくありません。');
    }
    const keys = [...new Set(tiles as string[])];
    const since = new Date(Date.now() - CACHE_DAYS * 86_400_000).toISOString();
    const { data: cached, error } = await admin.from('fuel_station_tiles').select('tile, stations').in('tile', keys).gte('fetched_at', since);
    if (error) throw new HttpError(500, 'db_error', error.message);
    const result = new Map<string, FuelStation[]>((cached ?? []).map((r) => [r.tile as string, r.stations as FuelStation[]]));
    for (const tile of keys.filter((k) => !result.has(k))) {
      const stations = await fetchTile(tile);
      result.set(tile, stations);
      await admin.from('fuel_station_tiles').upsert({ tile, stations, fetched_at: new Date().toISOString() });
    }
    return json({ tiles: Object.fromEntries(result), attribution: '© OpenStreetMap contributors' });
  }),
);
