import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { AppText, Badge, Card, Divider, ErrorView, ListRow, Loading, Screen, SectionTitle } from '../../components/ui';
import { signOut } from '../../lib/auth';
import { APP_OWNER, config, DEVELOPER } from '../../lib/config';
import { useInvalidate, useVehicleBundle } from '../../lib/data';
import { fullDate } from '../../lib/format';
import { STAFF_ORG_LABELS, useStaff } from '../../lib/staff';
import { invokeFunction } from '../../lib/supabase';
import { ACCENTS, BASES } from '../../palettes';
import { spacing, useTheme } from '../../theme';
import { toJstDate } from '@domain/dates.ts';

export default function Settings() {
  const { bundle } = useVehicleBundle();
  const invalidate = useInvalidate();
  const staff = useStaff();
  const { choice } = useTheme();
  const [busy, setBusy] = useState(false);

  if (bundle.isPending) return <Loading />;
  if (bundle.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;
  const { vehicle, ledraLink } = bundle.data;
  const linked = ledraLink?.status === 'active';

  const unlink = () =>
    Alert.alert('整備工場との連携を解除しますか', '解除すると、以後のオイル交換の記録は取り込まれません。取り込み済みの記録は残ります。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '解除する',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await invokeFunction('ledra-unlink', { linkId: ledraLink!.id });
            await invalidate();
          } catch (e) {
            Alert.alert('解除できませんでした', e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  const deleteAccount = () =>
    Alert.alert(
      'アカウントを削除しますか',
      '登録したクルマ・記録・維持費など、すべてのデータが削除され、元に戻せません。整備工場との連携も解除されます。\n\n複数台プランをお申し込みの場合は、先に App Store／Google Play の設定から解約してください（アカウントを削除しても解約にはなりません）。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除する',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await invokeFunction('delete-account');
              await signOut();
            } catch (e) {
              Alert.alert('削除できませんでした', e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );

  const openLegal = (url: string) => {
    if (url) Linking.openURL(url);
    else Alert.alert('準備中です', '文面の公開後に表示されます。');
  };

  return (
    <Screen>
      <SectionTitle>クルマ</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <ListRow title="クルマの切り替え・追加" detail="2台目からは複数台プラン" onPress={() => router.push('/vehicles')} />
        <Divider />
        <ListRow title="車両情報と周期" detail={`${vehicle.name}・オイル／フィルターの周期`} onPress={() => router.push('/settings/vehicle')} />
        <Divider />
        <ListRow title="車検・点検・保険の期限" onPress={() => router.push('/settings/deadlines')} />
        <Divider />
        <ListRow title="走行距離とメーター交換" onPress={() => router.push('/settings/odometer')} />
        <Divider />
        <ListRow title="記録の一覧" onPress={() => router.push('/records')} />
      </Card>

      <SectionTitle>表示</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <ListRow title="画面の色" detail={`${BASES[choice.base].label}・${ACCENTS[choice.accent].label}`} onPress={() => router.push('/settings/appearance')} />
        <Divider />
        <ListRow title="お知らせ" detail="アップデート・修正、たにぐち自動車の最新情報" onPress={() => router.push('/announcements')} />
      </Card>

      <SectionTitle>紹介</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <ListRow title="アプリを紹介する" detail="QRコード・リンクでダウンロードページを案内" onPress={() => router.push('/share')} />
      </Card>

      <SectionTitle>整備工場との連携</SectionTitle>
      <Card>
        {linked ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <AppText variant="heading">連携中</AppText>
              <Badge label="証明付きの記録を受け取ります" />
            </View>
            <AppText variant="caption">
              {ledraLink!.consent.shop_name ? `${ledraLink!.consent.shop_name}・` : ''}
              {fullDate(toJstDate(new Date(ledraLink!.consented_at)))} に連携
              {ledraLink!.last_synced_at ? `／最終取得 ${fullDate(toJstDate(new Date(ledraLink!.last_synced_at)))}` : ''}
            </AppText>
            <AppText variant="caption">整備工場で記録したオイル交換を、1時間ごとに取り込みます。</AppText>
            <ListRow title="連携を解除する" destructive onPress={busy ? undefined : unlink} />
          </>
        ) : (
          <>
            {ledraLink?.status === 'revoked_by_provider' && (
              <AppText variant="caption">
                整備工場側で連携が終了しました（クルマの所有者が変わった場合などに自動で終了します）。
              </AppText>
            )}
            <AppText variant="caption">
              Ledra を使っている整備工場で「イジログ連携用QR」を表示してもらい、読み取ると、オイル交換の記録を自動で受け取れます。
            </AppText>
            <ListRow title="QRコードを読み取って連携する" onPress={() => router.push('/ledra/scan')} />
          </>
        )}
      </Card>

      {staff.data && (
        <>
          <SectionTitle>運営メニュー</SectionTitle>
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            <AppText variant="caption" style={{ paddingTop: spacing.sm }}>{STAFF_ORG_LABELS[staff.data.org]}のスタッフとしてログインしています。</AppText>
            <ListRow title="お知らせの管理" detail="アップデート・修正のお知らせ、最新情報の配信" onPress={() => router.push('/admin/announcements')} />
            <Divider />
            <ListRow title="スポンサー広告の管理" detail="広告枠の掲載・表示回数" onPress={() => router.push('/admin/sponsors')} />
          </Card>
        </>
      )}

      <SectionTitle>アカウント</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <ListRow title="利用規約" onPress={() => openLegal(config.termsUrl)} />
        <Divider />
        <ListRow title="プライバシーポリシー" onPress={() => openLegal(config.privacyUrl)} />
        <Divider />
        <ListRow title="ログアウト" onPress={() => signOut()} />
        <Divider />
        <ListRow title="アカウントを削除する" destructive onPress={busy ? undefined : deleteAccount} />
      </Card>

      <AppText variant="caption" style={{ textAlign: 'center', marginTop: spacing.md }}>
        イジログは{APP_OWNER}のアプリです。{'\n'}開発・管理：{DEVELOPER}（{APP_OWNER}の委託先）
      </AppText>
    </Screen>
  );
}
