import { Alert, Linking, Platform } from 'react-native';
import { logShopAction, type ShopRow } from './data';
import { routeUrl, telUrl, type MapApp } from './geo';
import { withCode } from './error-codes';

function open(url: string) {
  Linking.openURL(url).catch(() => Alert.alert('開けませんでした', withCode('地図アプリまたはブラウザで開けませんでした。', 'IJ-APP-001')));
}

/**
 * 整備工場までのルートを地図アプリで開く。
 * iOS は Apple マップと Google マップを選べるようにし、Android は Google マップで開く
 */
export function openRoute(shop: ShopRow) {
  const go = (app: MapApp) => {
    logShopAction(shop.id, 'route');
    open(routeUrl(app, shop, shop.name));
  };
  if (Platform.OS !== 'ios') {
    go('google');
    return;
  }
  Alert.alert('ルートを検索', `${shop.name}までの道順を地図アプリで開きます。`, [
    { text: 'Apple マップ', onPress: () => go('apple') },
    { text: 'Google マップ', onPress: () => go('google') },
    { text: 'キャンセル', style: 'cancel' },
  ]);
}

export function callShop(shop: ShopRow) {
  if (!shop.phone) return;
  logShopAction(shop.id, 'call');
  open(telUrl(shop.phone));
}

export function openShopWebsite(shop: ShopRow) {
  if (!shop.website_url) return;
  logShopAction(shop.id, 'website');
  open(shop.website_url);
}
