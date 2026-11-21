import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { CONSENT_ITEMS, CONSENT_RECIPIENT, CONSENT_VERSION } from '@shared/ledra-records.ts';
import { AppText, Button, Card, Divider, ErrorView, Loading, Notice, Screen } from '../../components/ui';
import { useInvalidate, useVehicle } from '../../lib/data';
import { invokeFunction } from '../../lib/supabase';
import { spacing } from '../../theme';
import { alertError } from '../../lib/alerts';

/**
 * 連携内容の説明と同意。提供元・提供先・受け取る項目・解除方法を明記する。
 * 文面を変えたら CONSENT_VERSION を上げる（サーバーで同意の控えと一緒に記録する）。
 */
export default function Consent() {
  const { qr } = useLocalSearchParams<{ qr: string }>();
  const vehicle = useVehicle();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  // 提供元（QR を表示した整備工場）を同意の前に確かめる。トークンは消費しない
  const preview = useQuery({
    queryKey: ['ledra-preview', qr],
    enabled: !!qr,
    retry: false,
    staleTime: Infinity,
    queryFn: () => invokeFunction<{ shopName: string; expiresAt: string | null }>('ledra-preview', { qrData: qr }),
  });

  const agree = async () => {
    if (!vehicle.data || !qr) return;
    setBusy(true);
    try {
      const result = await invokeFunction<{ shopName: string | null; sync: { status: string; imported?: number } }>('ledra-link', {
        vehicleId: vehicle.data.id,
        qrData: qr,
        consentVersion: CONSENT_VERSION,
      });
      await invalidate();
      const imported = result.sync.status === 'ok' ? `${result.sync.imported ?? 0}件の記録を取り込みました。` : '記録はこのあと順次取り込みます。';
      Alert.alert('連携しました', `${result.shopName ?? shopName}と連携しました。${imported}`, [
        { text: 'OK', onPress: () => router.dismissTo('/settings') },
      ]);
    } catch (e) {
      alertError('連携できませんでした', e);
    } finally {
      setBusy(false);
    }
  };

  if (!qr) return <ErrorView message="QRコードを読み取れませんでした。" />;
  if (preview.isPending) return <Loading />;
  if (preview.isError) {
    return (
      <Screen>
        <Notice title="連携できません">{preview.error.message}</Notice>
        <Button title="QRコードを読み取り直す" onPress={() => router.replace('/ledra/scan')} />
        <Button title="やめる" variant="plain" onPress={() => router.back()} />
      </Screen>
    );
  }
  const shopName = preview.data.shopName;

  return (
    <Screen>
      <AppText>
        整備工場で記録したオイル交換を、イジログに自動で取り込みます。内容を確認して、同意する場合のみ連携してください。
      </AppText>
      <Card>
        <Item label="提供元">{`${shopName}\n（車両履歴サービス「Ledra」を利用する整備工場）`}</Item>
        <Divider />
        <Item label="提供先">{`${CONSENT_RECIPIENT}（イジログの運営者）`}</Item>
        <Divider />
        <Item label="受け取る項目">{`このクルマのオイル交換・タイヤ・ブレーキ・整備・車検に関する記録のみ\n${CONSENT_ITEMS.map((i) => `・${i}`).join('\n')}`}</Item>
        <Divider />
        <Item label="受け取らない項目">お名前・住所・電話番号、オイル交換以外の整備内容、写真、金額</Item>
        <Divider />
        <Item label="取り込みのタイミング">連携した時点と、その後1時間ごと</Item>
        <Divider />
        <Item label="解除の方法">
          イジログの「設定 → 整備工場との連携 → 連携を解除する」からいつでも解除できます。解除すると以後の取り込みは止まります。クルマの所有者が変わった場合は自動で終了します。
        </Item>
      </Card>
      <AppText variant="caption">
        取り込んだ記録は「証明付き」として表示し、アプリでは内容を変更できません。イジログの開発・管理は株式会社HOLY（{CONSENT_RECIPIENT}の委託先）が行います。
      </AppText>
      <View style={{ gap: spacing.sm }}>
        <Button title={`同意して${shopName}と連携する`} loading={busy} disabled={!vehicle.data} onPress={agree} />
        <Button title="やめる" variant="plain" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

function Item({ label, children }: { label: string; children: string }) {
  return (
    <View style={{ gap: 4 }}>
      <AppText variant="label">{label}</AppText>
      <AppText>{children}</AppText>
    </View>
  );
}
