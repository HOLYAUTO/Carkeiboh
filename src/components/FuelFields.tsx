import { View } from 'react-native';
import { FUEL_TYPE_LABELS, FUEL_TYPES, formatKmPerLiter, type FuelCost, type FuelPriceBasis, type FuelType } from '@domain/fuel.ts';
import { fromKm, type DistanceUnit } from '@domain/units.ts';
import { yen } from '../lib/format';
import { spacing } from '../theme';
import { AppText, Button, Divider, Field, Num, Segmented, ToggleRow } from './ui';

const FUEL_TYPE_OPTIONS = FUEL_TYPES.map((t) => ({ value: t, label: FUEL_TYPE_LABELS[t] }));
const BASIS_OPTIONS: { value: FuelPriceBasis; label: string }[] = [
  { value: 'tax_included', label: '税込の単価' },
  { value: 'tax_excluded', label: '税抜の単価' },
];

export interface FuelFieldsProps {
  fuelType: FuelType;
  onFuelType: (v: FuelType) => void;
  liters: string;
  onLiters: (v: string) => void;
  litersValid: boolean;
  unitPrice: string;
  onUnitPrice: (v: string) => void;
  unitPriceValid: boolean;
  basis: FuelPriceBasis;
  onBasis: (v: FuelPriceBasis) => void;
  fullTank: boolean;
  onFullTank: (v: boolean) => void;
}

/** 給油の入力欄（油種・給油量・単価・税込か税抜か・満タン） */
export function FuelFields(p: FuelFieldsProps) {
  return (
    <>
      <AppText variant="label">油種</AppText>
      <Segmented options={FUEL_TYPE_OPTIONS} value={p.fuelType} onChange={p.onFuelType} />
      <Field
        label="給油量（任意）"
        value={p.liters}
        onChangeText={p.onLiters}
        keyboardType="decimal-pad"
        suffix="L"
        placeholder="例：32.15"
        hint={p.litersValid ? '入れると平均燃費を計算します。' : '数字で入力してください（小数2桁まで）'}
      />
      <Field
        label="単価（任意）"
        value={p.unitPrice}
        onChangeText={p.onUnitPrice}
        keyboardType="decimal-pad"
        suffix="円/L"
        placeholder="例：172"
        hint={p.unitPriceValid ? undefined : '数字で入力してください（小数1桁まで）'}
      />
      <Segmented options={BASIS_OPTIONS} value={p.basis} onChange={p.onBasis} />
      <AppText variant="caption">
        {p.basis === 'tax_included'
          ? '店頭やレシートの単価です（税金をすべて含みます）。'
          : 'かけ売りの請求書の単価です。消費税（軽油は軽油引取税も）を足して金額を計算します。'}
      </AppText>
      <ToggleRow title="満タンにした" description="満タンから次の満タンまでの走行距離と給油量で燃費を計算します。" value={p.fullTank} onChange={p.onFullTank} />
    </>
  );
}

/** 給油量と単価から計算した税の内訳 */
export function FuelBreakdown({
  cost,
  fuelType,
  amountYen,
  onUseTotal,
}: {
  cost: FuelCost;
  fuelType: FuelType;
  /** 入力されている金額。計算と違えば知らせる */
  amountYen: number | null;
  onUseTotal: () => void;
}) {
  const rows: [string, number][] = [
    ['本体価格', cost.baseYen],
    ...(fuelType === 'diesel'
      ? ([['軽油引取税', cost.dieselDeliveryTaxYen]] as [string, number][])
      : ([
          ['揮発油税', cost.gasolineTaxYen],
          ['地方揮発油税', cost.localGasolineTaxYen],
        ] as [string, number][])),
    ['石油石炭税', cost.petroleumCoalTaxYen],
    [`消費税（${cost.consumptionTaxPercent}%）`, cost.consumptionTaxYen],
  ];
  const differs = amountYen != null && Number.isFinite(amountYen) && amountYen !== cost.totalYen;
  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="label">税の内訳（給油量と単価から自動計算）</AppText>
      {rows.map(([label, value]) => (
        <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <AppText variant="caption">{label}</AppText>
          <Num>{yen(value)}</Num>
        </View>
      ))}
      <Divider />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <AppText>合計</AppText>
        <Num size={18}>{yen(cost.totalYen)}</Num>
      </View>
      <AppText variant="caption">税額は給油した日の税率で計算した目安です（1円未満は切り捨て）。</AppText>
      {differs && (
        <>
          <AppText variant="caption">入力した金額（{yen(amountYen!)}）と計算した合計が違います。レシートがあれば、レシートの合計を正としてください。</AppText>
          <Button title={`計算した合計（${yen(cost.totalYen)}）にする`} variant="secondary" onPress={onUseTotal} />
        </>
      )}
    </View>
  );
}

/** 保存しようとしている給油までの燃費（前回の満タンから） */
export function FuelEconomyPreview({ kmPerLiter, distanceKm, liters, unit }: { kmPerLiter: number; distanceKm: number; liters: number; unit: DistanceUnit }) {
  return (
    <View style={{ gap: 2 }}>
      <AppText variant="label">前回の満タンからの燃費</AppText>
      <Num size={22}>{formatKmPerLiter(kmPerLiter)}</Num>
      <AppText variant="caption">
        {`${fromKm(distanceKm, unit).toLocaleString('ja-JP')}${unit === 'mile' ? 'mile' : 'km'} ÷ ${liters.toLocaleString('ja-JP')}L`}
      </AppText>
    </View>
  );
}
