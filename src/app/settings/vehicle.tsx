import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { DEFAULT_FILTER_INTERVAL, OIL_INTERVAL_KM_CHOICES, OIL_INTERVAL_MONTH_CHOICES } from '@domain/service.ts';
import { distanceUnitLabel, fromKm, toKm, type DistanceUnit } from '@domain/units.ts';
import { AppText, Button, Card, ErrorView, Field, Loading, Screen, SectionTitle, Segmented } from '../../components/ui';
import { updateVehicle, useInvalidate, useVehicleBundle, type VehicleRow } from '../../lib/data';
import { km, parseInteger } from '../../lib/format';
import { fonts, MIN_TAP, radius, spacing, useColors } from '../../theme';

const UNIT_OPTIONS: { value: DistanceUnit; label: string }[] = [
  { value: 'km', label: 'km' },
  { value: 'mile', label: 'mile（マイル）' },
];

function Chips<T extends number>({ options, value, onChange, unit }: { options: readonly T[]; value: number | null; onChange: (v: T) => void; unit: string }) {
  const colors = useColors();
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
            <Text style={{ fontFamily: fonts.num, color: selected ? colors.onAccent : colors.accentText }}>
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
  // 距離の入力欄はメーターの単位で見せ、保存するときに km に直す
  const [unit, setUnit] = useState<DistanceUnit>(vehicle.distance_unit === 'mile' ? 'mile' : 'km');
  const shown = (value: number | null) => (value != null ? String(fromKm(value, unit)) : '');
  const [annual, setAnnual] = useState(shown(vehicle.annual_km_estimate));
  const [oilKm, setOilKm] = useState(shown(vehicle.oil_interval_km));
  const [oilMonths, setOilMonths] = useState<number | null>(vehicle.oil_interval_months);
  const [filterKm, setFilterKm] = useState(shown(vehicle.filter_interval_km));
  const [filterMonths, setFilterMonths] = useState(vehicle.filter_interval_months != null ? String(vehicle.filter_interval_months) : '');
  const [busy, setBusy] = useState(false);

  const inKm = (text: string) => {
    const n = parseInteger(text);
    return n == null ? null : toKm(n, unit);
  };
  const annualKm = inKm(annual);
  const oilKmN = inKm(oilKm);
  const filterKmN = inKm(filterKm);
  /** 単位を切り替えたら、入力中の値も新しい単位に直す（同じ距離のまま） */
  const changeUnit = (next: DistanceUnit) => {
    const convert = (text: string) => {
      const n = parseInteger(text);
      return n == null || !Number.isFinite(n) ? text : String(fromKm(toKm(n, unit), next));
    };
    setAnnual(convert(annual));
    setOilKm(convert(oilKm));
    setFilterKm(convert(filterKm));
    setUnit(next);
  };
  const unitLabel = distanceUnitLabel(unit);
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
        distance_unit: unit,
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
        <Field label="年間走行距離の目安" value={annual} onChangeText={setAnnual} keyboardType="number-pad" suffix={unitLabel} hint="走行距離の記録が2件以上たまるまで、ペースの計算に使います。" />
      </Card>

      <SectionTitle>メーターの単位</SectionTitle>
      <Card>
        <Segmented options={UNIT_OPTIONS} value={unit} onChange={changeUnit} />
        <AppText variant="caption">
          走行距離の入力と表示、お知らせの距離をこの単位にします。これまでの記録は同じ距離のまま換算して表示します（1mile = 1.609344km）。燃費は km/L で表示します。
        </AppText>
      </Card>

      <SectionTitle>オイルの周期</SectionTitle>
      <Card>
        <AppText variant="label">距離</AppText>
        {/* 選択肢は km のきりのよい値なので、mile のときは入力欄だけにする */}
        {unit === 'km' && <Chips options={OIL_INTERVAL_KM_CHOICES} value={oilKmN} onChange={(v) => setOilKm(String(v))} unit="km" />}
        <Field label={unit === 'km' ? '距離を入力（任意の値）' : '距離'} value={oilKm} onChangeText={setOilKm} keyboardType="number-pad" suffix={unitLabel} />
        <AppText variant="label">期間</AppText>
        <Chips options={OIL_INTERVAL_MONTH_CHOICES} value={oilMonths} onChange={setOilMonths} unit="か月" />
        <AppText variant="caption">距離と期間の早い方を次回の目安にします。</AppText>
      </Card>

      <SectionTitle>オイルフィルターの周期</SectionTitle>
      <Card>
        <Field label="距離" value={filterKm} onChangeText={setFilterKm} keyboardType="number-pad" suffix={unitLabel} hint={`既定は ${km(DEFAULT_FILTER_INTERVAL.km!, unit)} です。`} />
        <Field label="期間（任意）" value={filterMonths} onChangeText={setFilterMonths} keyboardType="number-pad" suffix="か月" />
      </Card>

      <SectionTitle>車検証</SectionTitle>
      <Card>
        <AppText variant="caption">車検証の内容（種別・用途・排気量・重さなど）を入れると、自動車税と車検の重量税を自動で計算します。写真で読み取れます。</AppText>
        <Button title="車検証の内容を見る・入れる" variant="secondary" onPress={() => router.push('/settings/certificate')} />
      </Card>

      <Button title="保存する" disabled={!valid} loading={busy} onPress={save} />
      <Button title="このクルマを手放す（乗り換え・廃車）" variant="destructive" disabled={busy} onPress={() => router.push('/vehicles/release')} />
    </Screen>
  );
}
