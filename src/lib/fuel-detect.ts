/**
 * ガソリンスタンドに来たことを見つけて、給油の記録を勧める。どうするかは最初に一度だけ利用者に選んでもらい、端末に保存する。
 * - off：使わない（位置情報を使わない）
 * - on_open：アプリを開いたときだけ、近くのスタンドを調べる（「使用中のみ」の許可。バッテリーはほぼ使わない）
 * - after_visit：スタンドを出たら通知する（「常に許可」が要る。src/lib/fuel-geofence.ts）。アプリを開いたときの知らせも出す
 * 現在地はサーバーに送らない。約5km四方の区画の名前だけを送ってスタンドの一覧を受け取り、近いかは端末で計算する。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { AT_STATION_METERS, stationAt, tilesAround, type FuelStation } from '@shared/fuel-stations.ts';
import { invokeFunction } from './supabase';

export const FUEL_DETECT_MODES = ['off', 'on_open', 'after_visit'] as const;
export type FuelDetectMode = (typeof FUEL_DETECT_MODES)[number];

const MODE_KEY = 'ijilog.fuelDetectMode';
const DISMISSED_KEY = 'ijilog.fuelPromptDismissed';
const TILE_KEY_PREFIX = 'ijilog.fuelStations.';
const TILE_CACHE_DAYS = 30;
/** 端末が覚えている位置で十分な鮮度（アプリを開いた時点でスタンドにいるかを見るので短め） */
const LAST_KNOWN_MAX_AGE_MS = 2 * 60_000;

function isMode(v: unknown): v is FuelDetectMode {
  return typeof v === 'string' && (FUEL_DETECT_MODES as readonly string[]).includes(v);
}

/** 選んだ方法。まだ選んでいなければ null */
export function useFuelDetectMode() {
  return useQuery({
    queryKey: ['fuel-detect-mode'],
    queryFn: async (): Promise<FuelDetectMode | null> => {
      const v = await AsyncStorage.getItem(MODE_KEY).catch(() => null);
      return isMode(v) ? v : null;
    },
    staleTime: Infinity,
  });
}

export function useSetFuelDetectMode() {
  const qc = useQueryClient();
  return async (mode: FuelDetectMode) => {
    await AsyncStorage.setItem(MODE_KEY, mode).catch(() => {});
    qc.setQueryData(['fuel-detect-mode'], mode);
  };
}

/** 区画ごとのスタンドの一覧。端末に30日ためておき、無い区画だけサーバーに聞く */
export async function stationsInTiles(tiles: string[]): Promise<FuelStation[]> {
  const now = Date.now();
  const found: FuelStation[] = [];
  const missing: string[] = [];
  for (const tile of tiles) {
    const raw = await AsyncStorage.getItem(TILE_KEY_PREFIX + tile).catch(() => null);
    const cached = raw ? (JSON.parse(raw) as { at: number; stations: FuelStation[] }) : null;
    if (cached && now - cached.at < TILE_CACHE_DAYS * 86_400_000) found.push(...cached.stations);
    else missing.push(tile);
  }
  if (missing.length > 0) {
    const res = await invokeFunction<{ tiles: Record<string, FuelStation[]> }>('fuel-stations', { tiles: missing });
    for (const [tile, stations] of Object.entries(res.tiles)) {
      found.push(...stations);
      await AsyncStorage.setItem(TILE_KEY_PREFIX + tile, JSON.stringify({ at: now, stations })).catch(() => {});
    }
  }
  return found;
}

/** 今いるスタンド。許可が無い・位置が取れないときは null（許可はここでは求めない） */
export async function findStationHere(): Promise<FuelStation | null> {
  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) return null;
  const position =
    (await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS })) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  const here = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
  const stations = await stationsInTiles(tilesAround(here, AT_STATION_METERS + Math.min(here.accuracy ?? 0, 300)));
  return stationAt(here, stations);
}

/** 「今日はこのスタンドのお知らせを出さない」の印（記録した・閉じた） */
async function dismissedToday(stationId: string, today: string): Promise<boolean> {
  return (await AsyncStorage.getItem(DISMISSED_KEY).catch(() => null)) === `${stationId}@${today}`;
}

export async function dismissStationPrompt(stationId: string, today: string) {
  await AsyncStorage.setItem(DISMISSED_KEY, `${stationId}@${today}`).catch(() => {});
}

/**
 * ホームを開いたとき・アプリを前に戻したときに、スタンドにいるかを調べる。
 * 「使わない」を選んだ・まだ選んでいない・今日もう給油を記録した、なら調べない
 */
export function useStationHere(today: string, fueledToday: boolean): { station: FuelStation | null; dismiss: () => void } {
  const mode = useFuelDetectMode();
  const [station, setStation] = useState<FuelStation | null>(null);
  const enabled = !!mode.data && mode.data !== 'off' && !fueledToday;

  const check = useCallback(() => {
    if (!enabled) {
      setStation(null);
      return;
    }
    let active = true;
    findStationHere()
      .then(async (s) => {
        if (!active) return;
        setStation(s && !(await dismissedToday(s.id, today)) ? s : null);
      })
      .catch(() => active && setStation(null));
    return () => {
      active = false;
    };
  }, [enabled, today]);

  useFocusEffect(check);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  const dismiss = useCallback(() => {
    if (station) dismissStationPrompt(station.id, today);
    setStation(null);
  }, [station, today]);

  return { station, dismiss };
}
