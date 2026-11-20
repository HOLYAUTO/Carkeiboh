import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { DEFAULT_FILTER_INTERVAL, DEFAULT_OIL_INTERVAL } from '@domain/service.ts';
import { distanceUnitLabel, toKm, type DistanceUnit } from '@domain/units.ts';
import { createVehicle } from '../lib/data';
import { km, parseInteger } from '../lib/format';
import { fonts, MIN_TAP, radius, spacing, useColors } from '../theme';
import { AppText, Button, Card, DateField, Field, Segmented } from './ui';
import { errorMessage } from '../lib/alerts';

/** 年間走行距離の選択肢（メーターの単位の値）。mile は km の選択肢に近いきりのよい値 */
const ANNUAL_PRESETS: Record<DistanceUnit, { values: number[]; initial: number }> = {
  km: { values: [3000, 5000, 8000, 10000, 15000], initial: 8000 },
  mile: { values: [2000, 3000, 5000, 6000, 9000], initial: 5000 },
};
const UNIT_OPTIONS: { value: DistanceUnit; label: string }[] = [
  { value: 'km', label: 'km' },
  { value: 'mile', label: 'mile（マイル）' },
];

/**
 * 車両の登録。初回設定と「車両を追加」で同じものを使う。
 * 1分以内で終わる量に絞る（周期は既定値で始め、あとから設定で変えられる）
 */
export function VehicleForm({ submitTitle, onCreated }: { submitTitle: string; onCreated: (vehicleId: string) => Promise<void> }) {
  const colors = useColors();
  const [name, setName] = useState('');
  const [plate, setPlate] = useState('');
  const [unit, setUnit] = useState<DistanceUnit>('km');
  const [odo, setOdo] = useState('');
  const [annual, setAnnual] = useState<number | null>(ANNUAL_PRESETS.km.initial);
  const [shaken, setShaken] = useState<string | null>(null);
  const [insurance, setInsurance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const odoInput = parseInteger(odo);
  const odoKm = odoInput == null ? null : toKm(odoInput, unit);
  const valid = name.trim().length > 0 && odoKm != null && Number.isFinite(odoKm) && odoKm <= 2_000_000 && annual != null;
  const changeUnit = (u: DistanceUnit) => {
    setUnit(u);
    setAnnual(ANNUAL_PRESETS[u].initial);
  };

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const vehicle = await createVehicle({
        name: name.trim(),
        distanceUnit: unit,
        plateNumber: plate.trim() || null,
        odoKm: odoKm!,
        annualKmEstimate: toKm(annual!, unit),
        shakenDueOn: shaken,
        insuranceDueOn: insurance,
        oilIntervalKm: DEFAULT_OIL_INTERVAL.km!,
        oilIntervalMonths: DEFAULT_OIL_INTERVAL.months!,
        filterIntervalKm: DEFAULT_FILTER_INTERVAL.km!,
        filterIntervalMonths: DEFAULT_FILTER_INTERVAL.months!,
      });
      await onCreated(vehicle.id);
    } catch (e) {
      const message = errorMessage(e);
      if (message.includes('vehicle_limit_reached')) {
        Alert.alert('登録できる台数の上限です', '2台目からは複数台プランで登録できます。', [
          { text: '閉じる', style: 'cancel' },
          { text: 'プランを見る', onPress: () => router.push('/plan') },
        ]);
      } else {
        Alert.alert('登録できませんでした', message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <Field label="車名" value={name} onChangeText={setName} placeholder="例：N-BOX" maxLength={50} />
        <Field label="ナンバー（任意）" value={plate} onChangeText={setPlate} placeholder="例：品川 500 あ 12-34" maxLength={30} />
        <AppText variant="label">メーターの単位</AppText>
        <Segmented options={UNIT_OPTIONS} value={unit} onChange={changeUnit} />
        <Field
          label="現在の走行距離（ODO）"
          value={odo}
          onChangeText={setOdo}
          keyboardType="number-pad"
          suffix={distanceUnitLabel(unit)}
          placeholder="例：41200"
        />
      </Card>
      <Card>
        <AppText variant="label">1年間に走る距離の目安</AppText>
        <AppText variant="caption">
          エンジンオイル交換の次回の時期を予想するのに使います。走行距離の記録が2件以上たまると、実際のペースで予想します。
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {ANNUAL_PRESETS[unit].values.map((v) => {
            const selected = annual === v;
            return (
              <Pressable
                key={v}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setAnnual(v)}
                style={{
                  minHeight: MIN_TAP,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.control,
                  justifyContent: 'center',
                  backgroundColor: selected ? colors.accent : colors.accentSoft,
                }}
              >
                <Text style={{ fontFamily: fonts.num, color: selected ? colors.onAccent : colors.accentText }}>
                  {v.toLocaleString('ja-JP')}
                  {distanceUnitLabel(unit)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <AppText variant="caption">
          エンジンオイル交換の周期は{km(DEFAULT_OIL_INTERVAL.km!, unit)}・{DEFAULT_OIL_INTERVAL.months}か月、オイルフィルターは
          {km(DEFAULT_FILTER_INTERVAL.km!, unit)}・{DEFAULT_FILTER_INTERVAL.months}か月で始めます。設定の「車両情報と周期」で変えられます。
        </AppText>
      </Card>
      <Card>
        <DateField label="車検満了日（任意）" value={shaken} onChange={setShaken} optional />
        <DateField label="自動車保険の満期日（任意）" value={insurance} onChange={setInsurance} optional />
      </Card>
      <Button title={submitTitle} disabled={!valid} loading={busy} onPress={submit} />
    </>
  );
}
