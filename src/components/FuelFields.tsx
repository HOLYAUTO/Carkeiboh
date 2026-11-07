import { View } from 'react-native';
import { FUEL_TYPE_LABELS, FUEL_TYPES, formatKmPerLiter, type FuelType } from '@domain/fuel.ts';
import { fromKm, type DistanceUnit } from '@domain/units.ts';
import { AppText, Field, Num, Segmented, ToggleRow } from './ui';

const FUEL_TYPE_OPTIONS = FUEL_TYPES.map((t) => ({ value: t, label: FUEL_TYPE_LABELS[t] }));

export interface FuelFieldsProps {
  fuelType: FuelType;
  onFuelType: (v: FuelType) => void;
  liters: string;
  onLiters: (v: string) => void;
  litersValid: boolean;
  unitPrice: string;
  onUnitPrice: (v: string) => void;
  unitPriceValid: boolean;
  /** かけ（後払い）なら、単価は請求書の税抜の単価 */
  onAccount: boolean;
  fullTank: boolean;
  onFullTank: (v: boolean) => void;
}

/** 給油の入力欄（油種・給油量・単価・満タン）。単価が税込か税抜かは、支払い方法（その場で／かけ）で決める */
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
        label={p.onAccount ? '単価（税抜・請求書の単価・任意）' : '単価（任意）'}
        value={p.unitPrice}
        onChangeText={p.onUnitPrice}
        keyboardType="decimal-pad"
        suffix="円/L"
        placeholder="例：172"
        hint={p.unitPriceValid ? undefined : '数字で入力してください（小数1桁まで）'}
      />
      <ToggleRow title="満タンにした" description="満タンから次の満タンまでの走行距離と給油量で燃費を計算します。" value={p.fullTank} onChange={p.onFullTank} />
    </>
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
