import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { DEFAULT_FILTER_INTERVAL, DEFAULT_OIL_INTERVAL } from '@domain/service.ts';
import { createVehicle } from '../lib/data';
import { parseInteger } from '../lib/format';
import { colors, fonts, MIN_TAP, radius, spacing } from '../theme';
import { AppText, Button, Card, DateField, Field } from './ui';

const ANNUAL_PRESETS = [3000, 5000, 8000, 10000, 15000];

/**
 * 車両の登録。初回設定と「車両を追加」で同じものを使う。
 * 1分以内で終わる量に絞る（周期は既定値で始め、あとから設定で変えられる）
 */
export function VehicleForm({ submitTitle, onCreated }: { submitTitle: string; onCreated: (vehicleId: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [plate, setPlate] = useState('');
  const [odo, setOdo] = useState('');
  const [annual, setAnnual] = useState<number | null>(8000);
  const [shaken, setShaken] = useState<string | null>(null);
  const [insurance, setInsurance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const odoKm = parseInteger(odo);
  const valid = name.trim().length > 0 && odoKm != null && Number.isFinite(odoKm) && annual != null;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const vehicle = await createVehicle({
        name: name.trim(),
        plateNumber: plate.trim() || null,
        odoKm: odoKm!,
        annualKmEstimate: annual!,
        shakenDueOn: shaken,
        insuranceDueOn: insurance,
        oilIntervalKm: DEFAULT_OIL_INTERVAL.km!,
        oilIntervalMonths: DEFAULT_OIL_INTERVAL.months!,
        filterIntervalKm: DEFAULT_FILTER_INTERVAL.km!,
        filterIntervalMonths: DEFAULT_FILTER_INTERVAL.months!,
      });
      await onCreated(vehicle.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
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
        <Field label="現在の走行距離（ODO）" value={odo} onChangeText={setOdo} keyboardType="number-pad" suffix="km" placeholder="例：41200" />
      </Card>
      <Card>
        <AppText variant="label">年間走行距離の目安</AppText>
        <AppText variant="caption">走行距離の記録が2件以上たまるまで、次回の目安の計算に使います。</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {ANNUAL_PRESETS.map((v) => {
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
                <Text style={{ fontFamily: fonts.mono, color: selected ? colors.white : colors.accent }}>
                  {v.toLocaleString('ja-JP')}km
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>
      <Card>
        <DateField label="車検満了日（任意）" value={shaken} onChange={setShaken} optional />
        <DateField label="自動車保険の満期日（任意）" value={insurance} onChange={setInsurance} optional />
      </Card>
      <Button title={submitTitle} disabled={!valid} loading={busy} onPress={submit} />
    </>
  );
}
