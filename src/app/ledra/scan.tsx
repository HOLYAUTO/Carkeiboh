import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { extractLinkToken } from '@shared/ledra-records.ts';
import { AppText, Button, Loading, Notice, Screen } from '../../components/ui';
import { colors, radius, spacing } from '../../theme';

/** 整備工場が表示した「カーケイボー連携用QR」を読み取る */
export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  if (!permission) return <Loading />;
  if (!permission.granted) {
    return (
      <Screen>
        <AppText>QRコードを読み取るために、カメラを使います。</AppText>
        {permission.canAskAgain ? (
          <Button title="カメラを許可する" onPress={requestPermission} />
        ) : (
          <Button title="設定を開く" onPress={() => Linking.openSettings()} />
        )}
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          if (!extractLinkToken(data)) {
            setError('連携用のQRコードではないようです。整備工場で「カーケイボー連携用QR」を表示してもらってください。');
            return;
          }
          handled.current = true;
          router.replace({ pathname: '/ledra/consent', params: { qr: data } });
        }}
      />
      <View style={styles.frame} pointerEvents="none" />
      <View style={styles.footer}>
        {error ? <Notice>{error}</Notice> : <AppText style={{ textAlign: 'center' }}>枠の中にQRコードを写してください</AppText>}
        <Button title="キャンセル" variant="secondary" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    top: '22%',
    alignSelf: 'center',
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: colors.white,
    borderRadius: radius.card,
  },
  footer: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl * 2,
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.card,
    backgroundColor: colors.card,
  },
});
