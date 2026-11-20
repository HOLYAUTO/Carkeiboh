/**
 * 「スタンドを出たら通知する」：アプリを閉じていても、ガソリンスタンドに数分いて出たら「給油しましたか？」と通知する。
 *
 * - スマホの「指定した場所に出入りしたら知らせる」機能（ジオフェンス）を使う。GPS を回し続けないので、消耗は小さい
 * - iPhone は1つのアプリで20か所までなので、近くのスタンド19か所と、「今いる場所から2km離れたら登録し直す」ための1か所を登録する
 * - 位置情報を「常に許可」にしてもらう必要がある。正確な位置はサーバーに送らない（スタンドの一覧は区画の名前だけで受け取る）
 * - 立ち寄りは2〜60分の滞在だけ（前を通っただけ・長い駐車は除く）。そのあいだに給油を記録していたら通知しない
 *
 * TaskManager.defineTask はアプリの起動の最初に1回だけ呼ぶ必要があるので、このファイルはルートの _layout で読み込む。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { nearestStations, shouldNotifyVisit, tilesAround, type FuelStation } from '@shared/fuel-stations.ts';
import { stationsInTiles } from './fuel-detect';
import { STORAGE_KEYS } from './storage-keys';

export const FUEL_GEOFENCE_TASK = 'ijilog-fuel-geofence';

/** iPhone の上限（20か所）から、登録し直す用の1か所を引いた数 */
const MAX_STATIONS = 19;
/** スタンドの円の半径（m）。iPhone は100m より小さい円をうまく見張れない */
const STATION_RADIUS_M = 150;
/** 今いる場所からこれだけ離れたら、近くのスタンドを登録し直す */
const REFRESH_RADIUS_M = 2000;
/** 近くのスタンドを探す範囲（m）。区画で9つまで（fuel-stations の上限） */
const SEARCH_RADIUS_M = 3000;
const REFRESH_ID = 'refresh';
const CHANNEL_ID = 'fuel-visits';

/** スタンドの円の名前：`st|<id>|<店名>`（出入りのときに店名が要るので、名前に入れておく） */
function stationRegionId(s: FuelStation): string {
  return `st|${s.id}|${s.name}`;
}

function parseStationRegionId(id: string | undefined): { id: string; name: string } | null {
  const m = id?.match(/^st\|([^|]+)\|(.*)$/);
  return m ? { id: m[1], name: m[2] } : null;
}

function jstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** このアプリの版でアプリを閉じているときの見張りが使えるか（Expo Go・古いストア版では使えない） */
export async function isGeofencingSupported(): Promise<boolean> {
  try {
    return await TaskManager.isAvailableAsync();
  } catch {
    return false;
  }
}

/** 「常に許可」を求める（先に「使用中のみ」の許可が要る）。許可されたら true */
export async function requestAlwaysPermission(): Promise<boolean> {
  let fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted && fg.canAskAgain) fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return false;
  let bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted && bg.canAskAgain) bg = await Location.requestBackgroundPermissionsAsync();
  return bg.granted;
}

async function hasAlwaysPermission(): Promise<boolean> {
  try {
    return (await Location.getBackgroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

async function currentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
  const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null));
  return pos ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude } : null;
}

/** 今いる場所のまわりのスタンドを登録し直す。「常に許可」が無ければ何もしない */
export async function refreshFuelGeofences(): Promise<boolean> {
  if (!(await isGeofencingSupported()) || !(await hasAlwaysPermission())) return false;
  const here = await currentPosition();
  if (!here) return false;
  const stations = await stationsInTiles(tilesAround(here, SEARCH_RADIUS_M));
  const regions: Location.LocationRegion[] = nearestStations(here, stations, MAX_STATIONS).map((s) => ({
    identifier: stationRegionId(s),
    latitude: s.latitude,
    longitude: s.longitude,
    radius: STATION_RADIUS_M,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));
  regions.push({ identifier: REFRESH_ID, latitude: here.latitude, longitude: here.longitude, radius: REFRESH_RADIUS_M, notifyOnEnter: false, notifyOnExit: true });
  await Location.startGeofencingAsync(FUEL_GEOFENCE_TASK, regions);
  return true;
}

/** 見張りを止める（「スタンドを出たら通知」以外を選んだとき） */
export async function stopFuelGeofences() {
  try {
    if (await TaskManager.isTaskRegisteredAsync(FUEL_GEOFENCE_TASK)) await Location.stopGeofencingAsync(FUEL_GEOFENCE_TASK);
  } catch {
    // 権限が無くなっているときなど。止まっているのと同じ
  }
}

async function notifyVisit(stationName: string) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '給油の記録',
      // eslint-disable-next-line import/namespace
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '給油しましたか？',
      body: `${stationName}を出ました。押すと給油の記録を開きます。`,
      data: { kind: 'fuel_visit', station: stationName },
    },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
  });
}

/** スタンドの出入り。入った時刻を覚え、2〜60分いて出たら通知する（同じスタンドは1日1回まで） */
export async function handleGeofenceEvent(eventType: Location.GeofencingEventType, identifier: string | undefined, nowMs = Date.now()) {
  if (identifier === REFRESH_ID) {
    if (eventType === Location.GeofencingEventType.Exit) await refreshFuelGeofences();
    return;
  }
  const station = parseStationRegionId(identifier);
  if (!station) return;
  const enterKey = STORAGE_KEYS.fuelVisitEnterPrefix + station.id;
  if (eventType === Location.GeofencingEventType.Enter) {
    await AsyncStorage.setItem(enterKey, String(nowMs));
    return;
  }
  const entered = Number(await AsyncStorage.getItem(enterKey)) || null;
  await AsyncStorage.removeItem(enterKey);
  const todayKey = `${station.id}@${jstToday()}`;
  const notify = shouldNotifyVisit({
    enteredAtMs: entered,
    exitedAtMs: nowMs,
    lastFuelSavedAtMs: Number(await AsyncStorage.getItem(STORAGE_KEYS.lastFuelSavedAt)) || null,
    alreadyNotifiedToday: (await AsyncStorage.getItem(STORAGE_KEYS.fuelVisitNotified)) === todayKey,
  });
  if (!notify) return;
  await AsyncStorage.setItem(STORAGE_KEYS.fuelVisitNotified, todayKey);
  await notifyVisit(station.name);
}

// アプリが閉じていても、出入りのたびにここが呼ばれる（起動の最初に定義しておく必要がある）
try {
  if (!TaskManager.isTaskDefined(FUEL_GEOFENCE_TASK)) {
    TaskManager.defineTask<{ eventType: Location.GeofencingEventType; region: Location.LocationRegion }>(FUEL_GEOFENCE_TASK, async ({ data, error }) => {
      if (error || !data) return;
      try {
        await handleGeofenceEvent(data.eventType, data.region?.identifier);
      } catch (e) {
        console.warn('スタンドの出入りの処理に失敗しました', e);
      }
    });
  }
} catch {
  // TaskManager が入っていない版（Expo Go など）。見張りは使えない
}
