import { EXPENSE_CATEGORY_LABELS } from '@domain/costs.ts';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { RecordForm, wearTitle, type EditTarget, type RecordKind } from '../../components/RecordForm';
import { AppText, Badge, Button, Card, ErrorView, Field, Loading, Num, Screen } from '../../components/ui';
import {
  deleteExpense,
  deleteOdoReading,
  deleteOilChange,
  deleteWearCheck,
  saveOilChangeAmount,
  useInvalidate,
  useVehicleBundle,
  vehicleUnit,
  type OilChangeRow,
  type VehicleBundle,
  type ExpenseRow,
  type WearCheckRow,
} from '../../lib/data';
import { fullDate, km, parseInteger, yen } from '../../lib/format';
import { spacing } from '../../theme';

export default function EditRecord() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bundle } = useVehicleBundle();
  const invalidate = useInvalidate();

  if (bundle.isPending) return <Loading />;
  if (bundle.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;

  const [type, rowId] = (id ?? '').split(':');
  const data = bundle.data;
  let target: EditTarget | null = null;
  let kind: RecordKind | null = null;
  if (type === 'oil') {
    const row = data.oilChanges.find((o) => o.id === rowId);
    if (row) {
      target = { type: 'oil', row, expense: data.expenses.find((e) => e.oil_change_id === row.id) ?? null };
      kind = 'oil_change';
    }
  } else if (type === 'expense') {
    const row = data.expenses.find((e) => e.id === rowId);
    if (row) {
      target = { type: 'expense', row };
      kind = row.category;
    }
  } else if (type === 'wear') {
    const row = data.wearChecks.find((w) => w.id === rowId);
    if (row) {
      target = { type: 'wear', row };
      kind = row.kind;
    }
  } else if (type === 'odometer') {
    const row = data.readings.find((r) => r.id === rowId);
    if (row) {
      target = { type: 'odometer', row };
      kind = 'odometer';
    }
  }
  if (!target || !kind) return <ErrorView message="記録が見つかりません。" />;

  if (target.type === 'oil' && target.row.source === 'ledra') {
    return <LedraRecord bundle={data} row={target.row} expense={target.expense} />;
  }
  if (target.type === 'wear' && target.row.source === 'ledra') return <LedraWearRecord bundle={data} row={target.row} />;
  if (target.type === 'expense' && target.row.source === 'ledra') return <LedraExpenseRecord bundle={data} row={target.row} />;
  if (target.type === 'oil' && target.expense?.source === 'ledra') {
    return <LedraRecord bundle={data} row={target.row} expense={target.expense} />;
  }

  const remove = () =>
    Alert.alert('この記録を削除しますか', '削除すると元に戻せません。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: async () => {
          try {
            if (target!.type === 'oil') await deleteOilChange(target!.row.id);
            else if (target!.type === 'expense') await deleteExpense(target!.row.id);
            else if (target!.type === 'wear') await deleteWearCheck(target!.row.id);
            else await deleteOdoReading(target!.row.id);
            await invalidate();
            router.back();
          } catch (e) {
            Alert.alert('削除できませんでした', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);

  return (
    <Screen>
      <RecordForm bundle={data} kind={kind} target={target} onSaved={() => router.back()} />
      <Button title="この記録を削除する" variant="destructive" onPress={remove} />
    </Screen>
  );
}

/** Ledra から来た記録：本体は編集不可。金額だけ追記できる（支出1件として数え、二重計上しない） */
function LedraRecord({ bundle, row, expense }: { bundle: VehicleBundle; row: OilChangeRow; expense: ExpenseRow | null }) {
  const invalidate = useInvalidate();
  const [amount, setAmount] = useState(expense ? String(expense.amount_yen) : '');
  const [busy, setBusy] = useState(false);
  const amountYen = parseInteger(amount);
  const valid = amountYen == null || (Number.isFinite(amountYen) && amountYen > 0 && amountYen < 100_000_000);

  const save = async () => {
    setBusy(true);
    try {
      await saveOilChangeAmount(bundle.vehicle.id, row.id, row.performed_on, amountYen);
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <AppText variant="heading">オイル交換</AppText>
          <Badge label="証明付き" />
        </View>
        <AppText variant="caption">整備工場の記録（Ledra）から取り込んだ記録です。内容は変更できません。</AppText>
        <Info label="作業日" value={fullDate(row.performed_on)} />
        <Info label="走行距離（ODO）" value={km(row.odo_km, vehicleUnit(bundle.vehicle))} />
        <Info label="オイル交換" value={row.oil_changed ? 'あり' : 'なし'} />
        <Info label="オイルフィルター交換" value={row.filter_changed ? 'あり' : 'なし'} />
        {!!row.shop_name && <Info label="店舗" value={row.shop_name} mono={false} />}
      </Card>
      {expense?.source === 'ledra' ? (
        <Card>
          <Info label="金額（整備工場の記録）" value={yen(expense.amount_yen)} />
        </Card>
      ) : (
        <Card>
          <Field label="金額（任意）" value={amount} onChangeText={setAmount} keyboardType="number-pad" suffix="円" hint="入力すると維持費に1件として数えます。" />
          <Button title="金額を保存する" disabled={!valid} loading={busy} onPress={save} />
        </Card>
      )}
    </Screen>
  );
}

/** Ledra から来た整備・車検の金額：編集できない */
function LedraExpenseRecord({ bundle, row }: { bundle: VehicleBundle; row: ExpenseRow }) {
  return (
    <Screen>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <AppText variant="heading">{EXPENSE_CATEGORY_LABELS[row.category]}</AppText>
          <Badge label="証明付き" />
        </View>
        <AppText variant="caption">整備工場の記録（Ledra）から取り込んだ金額です。内容は変更できません。</AppText>
        <Info label="作業日" value={fullDate(row.spent_on)} />
        {row.odo_km != null && <Info label="走行距離（ODO）" value={km(row.odo_km, vehicleUnit(bundle.vehicle))} />}
        <Info label="金額" value={yen(row.amount_yen)} />
        {row.exempt_yen != null && <Info label="うち法定費用" value={yen(row.exempt_yen)} />}
        {!!row.note && <Info label="内容" value={row.note} mono={false} />}
      </Card>
    </Screen>
  );
}

/** Ledra から来たタイヤ・ブレーキの記録：編集できない（費用は「整備」から記録する） */
function LedraWearRecord({ bundle, row }: { bundle: VehicleBundle; row: WearCheckRow }) {
  return (
    <Screen>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <AppText variant="heading">{wearTitle(row)}</AppText>
          <Badge label="証明付き" />
        </View>
        <AppText variant="caption">整備工場の記録（Ledra）から取り込んだ記録です。内容は変更できません。</AppText>
        <Info label="作業日" value={fullDate(row.performed_on)} />
        {row.odo_km != null && <Info label="走行距離（ODO）" value={km(row.odo_km, vehicleUnit(bundle.vehicle))} />}
        <Info label={row.kind === 'tire' ? '溝の深さ' : 'パッドの厚さ'} value={row.remaining_mm != null ? `${Number(row.remaining_mm)}mm` : '—'} />
        {!!row.shop_name && <Info label="店舗" value={row.shop_name} mono={false} />}
      </Card>
    </Screen>
  );
}

function Info({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <AppText variant="label">{label}</AppText>
      {mono ? <Num>{value}</Num> : <AppText>{value}</AppText>}
    </View>
  );
}
