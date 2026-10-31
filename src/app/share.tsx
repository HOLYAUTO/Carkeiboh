import { useState } from 'react';
import { Platform, Share, useWindowDimensions, View } from 'react-native';
import { QrCode } from '../components/QrCode';
import { AppText, Button, Card, Notice, Screen, Segmented } from '../components/ui';
import { APP_NAME, APP_OWNER, config } from '../lib/config';
import { spacing } from '../theme';

type Store = 'ios' | 'android';

const STORES: Record<Store, { label: string; store: string; url: string }> = {
  ios: { label: 'iPhone', store: 'App Store', url: config.iosInstallUrl },
  android: { label: 'Android', store: 'Google Play', url: config.androidInstallUrl },
};

/**
 * アプリの紹介。店頭でスタッフがこの画面を見せ、お客さまのスマートフォンのカメラで読み取ってもらう。
 * QRコードには1つのリンクしか入らないため、iPhone と Android を切り替えて出す
 */
export default function ShareApp() {
  const [store, setStore] = useState<Store>(Platform.OS === 'android' ? 'android' : 'ios');
  const { width } = useWindowDimensions();
  const { label, store: storeName, url } = STORES[store];
  const qrSize = Math.min(width - spacing.lg * 4, 280);

  const shareLink = () =>
    Share.share({
      message: `${APP_NAME}（${APP_OWNER}のクルマの家計簿アプリ）\niPhone：${config.iosInstallUrl}\nAndroid：${config.androidInstallUrl}`,
    }).catch(() => {});

  return (
    <Screen>
      <AppText variant="caption">
        お客さまのスマートフォンのカメラでQRコードを読み取ってもらうと、{APP_NAME}のダウンロードページが開きます。
      </AppText>
      <Segmented
        options={[
          { value: 'ios', label: STORES.ios.label },
          { value: 'android', label: STORES.android.label },
        ]}
        value={store}
        onChange={setStore}
      />
      <Card style={{ alignItems: 'center', gap: spacing.md }}>
        <AppText variant="heading">{label}の方</AppText>
        <View style={{ padding: spacing.sm, backgroundColor: '#ffffff', borderRadius: 8 }}>
          <QrCode value={url} size={qrSize} label={`${APP_NAME}の${storeName}のページを開くQRコード`} />
        </View>
        <AppText variant="caption" style={{ textAlign: 'center' }}>
          {storeName}の{APP_NAME}のページが開きます
        </AppText>
      </Card>
      <Button title="リンクを送る（LINE・メールなど）" icon="share-outline" variant="secondary" onPress={shareLink} />
      <Notice>読み取れないときは、画面を明るくするか、「リンクを送る」で LINE やメールからリンクを送ってください。</Notice>
    </Screen>
  );
}
