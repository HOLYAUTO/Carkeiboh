import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import type { VehicleBundle } from '../lib/data';
import { useFuelDetectMode, useStationHere } from '../lib/fuel-detect';
import { refreshFuelGeofences } from '../lib/fuel-geofence';
import { spacing } from '../theme';
import { AppText, Button, Card } from './ui';

/**
 * ホームの上に出す「給油を記録する」。ガソリンスタンドでアプリを開いたときだけ出る。
 * 知らせ方をまだ選んでいなければ、最初に一度だけ選ぶ画面を開く
 */
export function FuelStationPrompt({ data }: { data: VehicleBundle }) {
  const mode = useFuelDetectMode();
  const fueledToday = data.expenses.some((e) => e.category === 'fuel' && e.spent_on === data.today);
  const { station, dismiss } = useStationHere(data.today, fueledToday);

  useEffect(() => {
    if (mode.isSuccess && mode.data === null) router.push('/fuel-detect');
    // 「スタンドを出たら通知」：アプリを開いたときに、今いる場所のまわりのスタンドを登録し直す（「常に許可」が外れていれば何もしない）
    if (mode.data === 'after_visit') refreshFuelGeofences().catch(() => {});
  }, [mode.isSuccess, mode.data]);

  if (!station) return null;
  return (
    <Card>
      <AppText variant="heading">{`${station.name}にいます`}</AppText>
      <AppText>給油したら、そのまま記録できます（日付・スタンド名・油種は入れておきます）。</AppText>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            title="給油を記録する"
            onPress={() => {
              dismiss();
              router.push({ pathname: '/records/new', params: { kind: 'fuel', station: station.name } });
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="今日は出さない" variant="secondary" onPress={dismiss} />
        </View>
      </View>
      <AppText variant="caption">スタンドの場所：© OpenStreetMap contributors</AppText>
    </Card>
  );
}
