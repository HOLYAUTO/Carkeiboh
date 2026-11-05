import { useState } from 'react';
import { distanceUnitLabel, toKm } from '@domain/units.ts';
import { Alert, View } from 'react-native';
import { AppText, Button, Card, DateField, Divider, ErrorView, Field, Loading, Screen, SectionTitle } from '../../components/ui';
import { addMeterReplacement, deleteMeterReplacement, useInvalidate, useVehicleBundle } from '../../lib/data';
import { fullDate, km, parseInteger } from '../../lib/format';
import { spacing } from '../../theme';

/** メーター交換の訂正履歴。交換後に値が戻っても、実走行距離で予測・集計できるようにする */
export default function OdometerSettings() {
  const { bundle } = useVehicleBundle();
  const invalidate = useInvalidate();
  const [date, setDate] = useState<string | null>(null);
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('0');
  const [busy, setBusy] = useState(false);

  if (bundle.isPending) return <Loading />;
  if (bundle.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;
  const { vehicle, meterReplacements, state } = bundle.data;
  const latest = state.readings.at(-1);
  // 入力はメーターの単位、保存は km
  const unit = vehicle.distance_unit === 'mile' ? 'mile' : 'km';
  const inKm = (text: string) => {
    const n = parseInteger(text);
    return n == null ? null : toKm(n, unit);
  };
  const beforeKm = inKm(before);
  const afterKm = inKm(after);
  const valid = !!date && beforeKm != null && Number.isFinite(beforeKm) && afterKm != null && Number.isFinite(afterKm);

  const save = async () => {
    setBusy(true);
    try {
      await addMeterReplacement({ vehicleId: vehicle.id, date: date!, odoBeforeKm: beforeKm!, odoAfterKm: afterKm! });
      await invalidate();
      setDate(null);
      setBefore('');
      setAfter('0');
    } catch (e) {
      Alert.alert('登録できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <AppText variant="label">最新の走行距離（実走行）</AppText>
        <AppText variant="heading">{latest ? `${km(latest.odoKm, unit)}（${fullDate(latest.date)}）` : '記録なし'}</AppText>
        <AppText variant="caption">走行距離は「記録する」の「走行距離だけ」からいつでも記録できます。記録が増えるほど予測が正確になります。</AppText>
      </Card>

      <SectionTitle>メーター交換の訂正</SectionTitle>
      <Card>
        <AppText variant="caption">
          メーターを交換して表示の値が戻った場合に登録します。交換後に入力した値へ、交換前の走行分を足して計算します。
        </AppText>
        <DateField label="交換した日" value={date} onChange={setDate} optional />
        <Field label="交換前のメーターの最終値" value={before} onChangeText={setBefore} keyboardType="number-pad" suffix={distanceUnitLabel(unit)} />
        <Field label="交換後のメーターの値" value={after} onChangeText={setAfter} keyboardType="number-pad" suffix={distanceUnitLabel(unit)} />
        <Button title="登録する" disabled={!valid} loading={busy} onPress={save} />
      </Card>

      {meterReplacements.length > 0 && (
        <Card style={{ gap: spacing.sm }}>
          {meterReplacements.map((m, i) => (
            <View key={m.id} style={{ gap: spacing.xs }}>
              {i > 0 && <Divider />}
              <AppText>
                {fullDate(m.replaced_on)}：{km(m.odo_before_km, unit)} → {km(m.odo_after_km, unit)}
              </AppText>
              <Button
                title="この訂正を削除"
                variant="plain"
                onPress={async () => {
                  await deleteMeterReplacement(m.id).catch((e) => Alert.alert('削除できませんでした', String(e)));
                  await invalidate();
                }}
              />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
