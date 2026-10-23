import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { OIL_INTERVAL_KM_CHOICES, OIL_INTERVAL_MONTH_CHOICES } from '@domain/service.ts';
import { AppText, Button, Card, ErrorView, Field, Loading, Screen, SectionTitle } from '../../components/ui';
import { updateVehicle, useInvalidate, useVehicleBundle, type VehicleRow } from '../../lib/data';
import { parseInteger } from '../../lib/format';
import { colors, fonts, MIN_TAP, radius, spacing } from '../../theme';

function Chips<T extends number>({ options, value, onChange, unit }: { options: readonly T[]; value: number | null; onChange: (v: T) => void; unit: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {options.map((o) => {
        const selected = value === o;
        return (
          <Pressable
            key={o}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(o)}
            style={{ minHeight: MIN_TAP, paddingHorizontal: spacing.md, borderRadius: radius.control, justifyContent: 'center', backgroundColor: selected ? colors.accent : colors.accentSoft }}
          >
            <Text style={{ fontFamily: fonts.mono, color: selected ? colors.white : colors.accent }}>
              {o.toLocaleString('ja-JP')}
              {unit}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function VehicleSettings() {
  const { bundle } = useVehicleBundle();
  if (bundle.isPending) return <Loading />;
  if (bundle.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;
  return <VehicleForm vehicle={bundle.data.vehicle} />;
}

function VehicleForm({ vehicle }: { vehicle: VehicleRow }) {
  const invalidate = useInvalidate();
  const [name, setName] = useState(vehicle.name);
  const [plate, setPlate] = useState(vehicle.plate_number ?? '');
  const [annual, setAnnual] = useState(String(vehicle.annual_km_estimate));
  const [oilKm, setOilKm] = useState(vehicle.oil_interval_km != null ? String(vehicle.oil_interval_km) : '');
  const [oilMonths, setOilMonths] = useState<number | null>(vehicle.oil_interval_months);
  const [filterKm, setFilterKm] = useState(vehicle.filter_interval_km != null ? String(vehicle.filter_interval_km) : '');
  const [filterMonths, setFilterMonths] = useState(vehicle.filter_interval_months != null ? String(vehicle.filter_interval_months) : '');
  const [busy, setBusy] = useState(false);

  const annualKm = parseInteger(annual);
  const oilKmN = parseInteger(oilKm);
  const filterKmN = parseInteger(filterKm);
  const filterMonthsN = parseInteger(filterMonths);
  const inRange = (v: number | null, min: number, max: number) => v == null || (Number.isFinite(v) && v >= min && v <= max);
  const valid =
    name.trim().length > 0 &&
    annualKm != null && inRange(annualKm, 0, 200000) &&
    inRange(oilKmN, 500, 50000) && (oilKmN != null || oilMonths != null) &&
    inRange(filterKmN, 500, 100000) && inRange(filterMonthsN, 1, 60) && (filterKmN != null || filterMonthsN != null);

  const save = async () => {
    setBusy(true);
    try {
      await updateVehicle(vehicle.id, {
        name: name.trim(),
        plate_number: plate.trim() || null,
        annual_km_estimate: annualKm!,
        oil_interval_km: oilKmN,
        oil_interval_months: oilMonths,
        filter_interval_km: filterKmN,
        filter_interval_months: filterMonthsN,
      });
      await invalidate();
      router.back();
    } catch (e) {
      Alert.alert('保存できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Field label="車名" value={name} onChangeText={setName} maxLength={50} />
        <Field label="ナンバー（任意）" value={plate} onChangeText={setPlate} maxLength={30} />
        <Field label="年間走行距離の目安" value={annual} onChangeText={setAnnual} keyboardType="number-pad" suffix="km" hint="走行距離の記録が2件以上たまるまで、ペースの計算に使います。" />
      </Card>

      <SectionTitle>オイルの周期</SectionTitle>
      <Card>
        <AppText variant="label">距離</AppText>
        <Chips options={OIL_INTERVAL_KM_CHOICES} value={oilKmN} onChange={(v) => setOilKm(String(v))} unit="km" />
        <Field label="距離を入力（任意の値）" value={oilKm} onChangeText={setOilKm} keyboardType="number-pad" suffix="km" />
        <AppText variant="label">期間</AppText>
        <Chips options={OIL_INTERVAL_MONTH_CHOICES} value={oilMonths} onChange={setOilMonths} unit="か月" />
        <AppText variant="caption">距離と期間の早い方を次回の目安にします。</AppText>
      </Card>

      <SectionTitle>オイルフィルターの周期</SectionTitle>
      <Card>
        <Field label="距離" value={filterKm} onChangeText={setFilterKm} keyboardType="number-pad" suffix="km" hint="既定は 10,000km です。" />
        <Field label="期間（任意）" value={filterMonths} onChangeText={setFilterMonths} keyboardType="number-pad" suffix="か月" />
      </Card>

      <Button title="保存する" disabled={!valid} loading={busy} onPress={save} />
    </Screen>
  );
}
