import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { AppText, Button, Card, DateField, Divider, ErrorView, Loading, Screen, SectionTitle, ToggleRow } from '../../components/ui';
import { releaseVehicle, selectVehicle, todayJst, useVehicle, useVehicles, type ReleaseReason } from '../../lib/data';
import { APP_NAME } from '../../lib/config';
import { fonts, MIN_TAP, radius, spacing, useColors } from '../../theme';
import { alertError } from '../../lib/alerts';

const REASONS: { value: ReleaseReason; title: string; description: string; icon: 'swap-horizontal' | 'close-circle-outline' }[] = [
  {
    value: 'transferred',
    title: '乗り換え（売却・下取り・譲渡）',
    description: 'このクルマをアプリから外し、新しいクルマの登録に進みます。次の持ち主は、整備工場で連携し直せます。',
    icon: 'swap-horizontal',
  },
  {
    value: 'scrapped',
    title: '廃車',
    description: `このクルマには、${APP_NAME}でも整備工場（Ledra）でも、以後だれも記録を足せなくなります。`,
    icon: 'close-circle-outline',
  },
];

/** 表示しているクルマを手放す（乗り換え・廃車）。記録はアプリから見えなくなるが、消さずに残す */
export default function ReleaseVehicle() {
  const vehicle = useVehicle();
  const vehicles = useVehicles();
  if (vehicle.isPending || vehicles.isPending) return <Loading />;
  if (vehicle.isError || !vehicle.data) return <ErrorView message="読み込めませんでした。" error={vehicle.error} code="IJ-DB-009" onRetry={() => vehicle.refetch()} />;
  const others = (vehicles.data ?? []).filter((v) => v.id !== vehicle.data!.id);
  return <Form vehicleId={vehicle.data.id} vehicleName={vehicle.data.name} nextVehicleId={others[0]?.id ?? null} />;
}

function Form({ vehicleId, vehicleName, nextVehicleId }: { vehicleId: string; vehicleName: string; nextVehicleId: string | null }) {
  const colors = useColors();
  const qc = useQueryClient();
  const [reason, setReason] = useState<ReleaseReason | null>(null);
  const [releasedOn, setReleasedOn] = useState<string | null>(todayJst());
  const [shareHistory, setShareHistory] = useState(false);
  const [busy, setBusy] = useState(false);

  const release = async () => {
    if (!reason || !releasedOn) return;
    setBusy(true);
    try {
      await releaseVehicle({ vehicleId, reason, releasedOn, shareHistory: reason === 'transferred' && shareHistory });
      // ほかにクルマがあればそちらを表示する。なければクルマの登録（初回設定）の画面に切り替わる
      if (nextVehicleId) await selectVehicle(qc, nextVehicleId);
      await qc.invalidateQueries();
      router.dismissAll();
    } catch (e) {
      alertError('手放せませんでした', e);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!reason) return;
    const scrapped = reason === 'scrapped';
    Alert.alert(
      scrapped ? `「${vehicleName}」を廃車にしますか` : `「${vehicleName}」を手放しますか`,
      [
        'このクルマはアプリに表示されなくなり、記録・通知もできなくなります。元に戻せません。',
        '整備工場との連携は解除されます。',
        scrapped ? '整備工場（Ledra）にも廃車を伝え、以後この車両の記録を受け付けないようにします。' : null,
        nextVehicleId ? null : 'このあと、新しいクルマの登録に進みます。',
      ]
        .filter(Boolean)
        .join('\n'),
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: scrapped ? '廃車にする' : '手放す', style: 'destructive', onPress: release },
      ],
    );
  };

  return (
    <Screen>
      <AppText variant="caption">
        「{vehicleName}」を手放したときの手続きです。記録はアプリから見えなくなりますが、消さずに残します（アカウントを削除したときは、すべて消えます）。
      </AppText>

      <SectionTitle>手放す理由</SectionTitle>
      <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
        {REASONS.map((r) => {
          const selected = reason === r.value;
          return (
            <Pressable
              key={r.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${r.title}。${r.description}`}
              onPress={() => setReason(r.value)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                gap: spacing.md,
                minHeight: MIN_TAP * 2,
                padding: spacing.lg,
                borderRadius: radius.card,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? colors.accent : colors.border,
                backgroundColor: colors.card,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.accentText : colors.textSecondary} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, gap: spacing.xs }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <Ionicons name={r.icon} size={16} color={colors.textSecondary} />
                  <AppText style={{ fontFamily: fonts.semibold, flexShrink: 1 }}>{r.title}</AppText>
                </View>
                <AppText variant="caption">{r.description}</AppText>
              </View>
            </Pressable>
          );
        })}
      </View>

      {reason && (
        <Card>
          <DateField label={reason === 'scrapped' ? '廃車にした日' : '手放した日'} value={releasedOn} onChange={setReleasedOn} />
          {reason === 'transferred' && (
            <>
              <Divider />
              <ToggleRow
                title="次の持ち主に記録を引き継げるようにする"
                description="準備中の機能です。オンにすると、次の持ち主がこのクルマを登録して整備工場と連携したときに、オイル交換などの記録を見られるようにする予定です。氏名・連絡先・メモ・写真は渡しません。"
                value={shareHistory}
                onChange={setShareHistory}
              />
            </>
          )}
        </Card>
      )}

      <Button
        title={reason === 'scrapped' ? '廃車にする' : 'このクルマを手放す'}
        variant="destructive"
        disabled={!reason || !releasedOn || (releasedOn ?? '') > todayJst()}
        loading={busy}
        onPress={confirm}
      />
    </Screen>
  );
}
