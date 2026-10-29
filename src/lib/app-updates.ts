import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { AppState } from 'react-native';

/** アプリを前面に戻したときに更新を確かめる間隔（開いたままの利用者にも、修正を早めに届けるため） */
const CHECK_INTERVAL_MS = 30 * 60_000;

/**
 * EAS Update で配った修正の受け取り。起動時の確認（expo-updates の既定）に加え、前面に戻ったときにも確かめて取り込んでおく。
 * 取り込み終わったら ready になり、ホームに「再起動して反映する」を出す
 */
export function useAppUpdate() {
  const { isUpdatePending } = Updates.useUpdates();

  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;
    let lastCheck = Date.now();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
      lastCheck = Date.now();
      Updates.checkForUpdateAsync()
        .then((result) => (result.isAvailable ? Updates.fetchUpdateAsync() : null))
        .catch(() => {});
    });
    return () => sub.remove();
  }, []);

  return { ready: isUpdatePending, restart: () => Updates.reloadAsync().catch(() => {}) };
}
