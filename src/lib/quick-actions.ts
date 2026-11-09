/**
 * ホーム画面のアイコンを長押ししたときに出す項目（iOS のクイックアクション・Android のショートカット）。
 * 押すと、その画面をすぐ開く（アプリを開いて項目を選ぶ手間を省く）。ログインしていなければログインの画面になる
 */
import * as QuickActions from 'expo-quick-actions';
import { useQuickActionRouting, type RouterAction } from 'expo-quick-actions/router';
import { useEffect } from 'react';

const ITEMS: RouterAction[] = [
  { id: 'fuel', title: '給油を記録', icon: 'symbol:fuelpump.fill', params: { href: '/records/new?kind=fuel' } },
  { id: 'receipt', title: 'レシートを撮る', icon: 'symbol:camera.fill', params: { href: '/records/receipts?camera=1' } },
  { id: 'odometer', title: '走行距離を記録', icon: 'symbol:gauge.with.dots.needle.67percent', params: { href: '/records/new?kind=odometer' } },
  { id: 'statement', title: '掛けカードの明細から登録', icon: 'symbol:doc.text.fill', params: { href: '/records/fuel-statement' } },
];

export function useQuickActions() {
  // 押された項目の href を開く
  useQuickActionRouting();
  useEffect(() => {
    QuickActions.isSupported()
      .then((ok) => (ok ? QuickActions.setItems(ITEMS) : undefined))
      .catch(() => {});
  }, []);
}
