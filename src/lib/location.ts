import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import type { LatLng } from './geo';

export type LocationState =
  | { status: 'loading' }
  | { status: 'ready'; position: LatLng }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'unavailable' };

/** 端末が覚えている位置で十分な鮮度（整備工場を近い順に並べるだけなので、数分前の位置でよい） */
const LAST_KNOWN_MAX_AGE_MS = 10 * 60_000;

/** 許可の確認から位置の取得まで。端末が覚えている位置を先に返し、取れたら今の位置で上書きする */
async function readLocation(ask: boolean, onUpdate: (state: LocationState) => void) {
  let ready = false;
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted && permission.canAskAgain && ask) permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      onUpdate({ status: 'denied', canAskAgain: permission.canAskAgain });
      return;
    }
    const last = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    if (last) {
      ready = true;
      onUpdate({ status: 'ready', position: last.coords });
    }
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    onUpdate({ status: 'ready', position: current.coords });
  } catch {
    if (!ready) onUpdate({ status: 'unavailable' });
  }
}

/**
 * 現在地（近くの整備工場を並べるためだけに使い、サーバーには送らない）。
 * まだ聞いていなければ、この画面を開いたときに許可を求める
 */
export function useCurrentPosition() {
  const [state, setState] = useState<LocationState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    readLocation(true, (next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  /** 「現在地を使う」ボタン用。もう聞けない場合は端末の設定を開く */
  const request = useCallback(() => {
    if (state.status === 'denied' && !state.canAskAgain) Linking.openSettings();
    else readLocation(true, setState);
  }, [state]);

  return { state, request, position: state.status === 'ready' ? state.position : null };
}
