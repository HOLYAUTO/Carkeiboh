import { describe, expect, it } from 'vitest';
import {
  distanceMeters,
  isTileKey,
  isVisit,
  nearestStations,
  parseOverpass,
  stationAt,
  tileBounds,
  tileOf,
  tilesAround,
  type FuelStation,
} from '../../supabase/functions/_shared/fuel-stations.ts';

const osaka = { latitude: 34.7025, longitude: 135.4959 };

describe('区画', () => {
  it('0.05度ごとの番号で、範囲が戻せる', () => {
    expect(tileOf(osaka)).toBe('694_2709');
    expect(tileBounds('694_2709')).toEqual({ south: 34.7, west: 135.45, north: 34.75, east: 135.5 });
    expect(isTileKey('694_2709')).toBe(true);
    expect(isTileKey('694_2709; drop')).toBe(false);
    expect(isTileKey('9999_0')).toBe(false);
  });
  it('区画の境の近くなら隣の区画も入れる', () => {
    expect(tilesAround(osaka, 150)).toEqual(['694_2709']);
    // 東経 135.5 の境から約 90m
    expect(new Set(tilesAround({ latitude: 34.7025, longitude: 135.499 }, 150))).toEqual(new Set(['694_2709', '694_2710']));
    expect(tilesAround(osaka, 6000).length).toBeGreaterThanOrEqual(4);
  });
});

describe('スタンドの判定', () => {
  const stations: FuelStation[] = [
    { id: 'node/1', name: 'A店', latitude: 34.7026, longitude: 135.496 },
    { id: 'node/2', name: 'B店', latitude: 34.71, longitude: 135.5 },
  ];
  it('150m 以内のいちばん近いスタンド', () => {
    expect(distanceMeters(osaka, stations[0])).toBeLessThan(20);
    expect(stationAt(osaka, stations)?.name).toBe('A店');
    expect(stationAt({ latitude: 34.72, longitude: 135.52 }, stations)).toBeNull();
  });
  it('位置の誤差が大きすぎるときは判定しない', () => {
    expect(stationAt({ ...osaka, accuracy: 1200 }, stations)).toBeNull();
  });
  it('近い順', () => {
    expect(nearestStations(osaka, stations, 1).map((s) => s.name)).toEqual(['A店']);
  });
  it('2〜60分の滞在を立ち寄りとみなす', () => {
    expect(isVisit(0, 60_000)).toBe(false);
    expect(isVisit(0, 5 * 60_000)).toBe(true);
    expect(isVisit(0, 90 * 60_000)).toBe(false);
  });
});

describe('parseOverpass', () => {
  it('node と way（center）を読み、名前が無ければブランド', () => {
    expect(
      parseOverpass({
        elements: [
          { type: 'node', id: 1, lat: 34.1, lon: 135.1, tags: { name: 'ENEOS 梅田SS' } },
          { type: 'way', id: 2, center: { lat: 34.2, lon: 135.2 }, tags: { brand: '出光' } },
          { type: 'node', id: 3, tags: { name: '位置なし' } },
        ],
      }),
    ).toEqual([
      { id: 'node/1', name: 'ENEOS 梅田SS', latitude: 34.1, longitude: 135.1 },
      { id: 'way/2', name: '出光', latitude: 34.2, longitude: 135.2 },
    ]);
    expect(parseOverpass(null)).toEqual([]);
  });
});
