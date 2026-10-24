import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Fragment } from 'react';
import { AppText, Badge, Card, Divider, ErrorView, ListRow, Loading, Screen, SectionTitle } from '../../components/ui';
import { selectVehicle, usePlan, useVehicle, useVehicles } from '../../lib/data';
import { colors } from '../../theme';

/** 車両の切り替えと追加。2台目からは複数台プラン（有料）で登録できる */
export default function Vehicles() {
  const qc = useQueryClient();
  const vehicles = useVehicles();
  const current = useVehicle();
  const plan = usePlan();

  if (vehicles.isPending || plan.isPending) return <Loading />;
  if (vehicles.isError || plan.isError) {
    return <ErrorView message="読み込めませんでした。" onRetry={() => Promise.all([vehicles.refetch(), plan.refetch()])} />;
  }
  const list = vehicles.data;
  const { plan: planName, vehicleLimit } = plan.data;
  const canAdd = list.length < vehicleLimit;

  return (
    <Screen>
      <SectionTitle>登録したクルマ</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {list.map((v, i) => {
          const selected = v.id === current.data?.id;
          return (
            <Fragment key={v.id}>
              {i > 0 && <Divider />}
              <ListRow
                title={v.name}
                detail={v.plate_number ?? undefined}
                right={selected ? <Ionicons name="checkmark-circle" size={22} color={colors.accent} accessibilityLabel="表示中" /> : undefined}
                onPress={async () => {
                  await selectVehicle(qc, v.id);
                  router.back();
                }}
              />
            </Fragment>
          );
        })}
      </Card>

      <SectionTitle>クルマを追加</SectionTitle>
      <Card>
        <Badge label={planName === 'plus' ? `複数台プラン・${vehicleLimit}台まで` : '無料プラン・1台まで'} tone={planName === 'plus' ? 'accent' : 'neutral'} />
        <AppText variant="caption">
          {canAdd
            ? `あと${vehicleLimit - list.length}台登録できます。家族のクルマもまとめて、1台ずつ記録・通知を管理できます。`
            : planName === 'plus'
              ? `登録できるのは${vehicleLimit}台までです。使わなくなったクルマは「車両情報と周期」から削除できます。`
              : '2台目からは複数台プラン（有料）で登録できます。'}
        </AppText>
        <ListRow
          title={canAdd ? 'クルマを追加する' : planName === 'plus' ? '上限に達しています' : '複数台プランを見る'}
          onPress={canAdd ? () => router.push('/vehicles/new') : planName === 'plus' ? undefined : () => router.push('/plan')}
        />
      </Card>
    </Screen>
  );
}
