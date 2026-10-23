import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from '@domain/costs.ts';
import { checkOdoEntry } from '@domain/odo.ts';
import {
  saveExpense,
  saveOdoReading,
  saveOilChange,
  useInvalidate,
  type ExpenseRow,
  type OdometerReadingRow,
  type OilChangeRow,
  type VehicleBundle,
} from '../lib/data';
import { parseInteger } from '../lib/format';
import { cardShadow, colors, fonts, radius, spacing } from '../theme';
import { AppText, Button, Card, DateField, Field, ToggleRow } from './ui';

/** 「記録する」で選ぶ項目。オイル交換・支出の各項目に加え、走行距離だけの記録もできる */
export type RecordKind = ExpenseCategory | 'odometer';

const KINDS: { kind: RecordKind; icon: keyof typeof Ionicons.glyphMap }[] = [
  { kind: 'oil_change', icon: 'water-outline' },
  { kind: 'fuel', icon: 'speedometer-outline' },
  { kind: 'maintenance', icon: 'construct-outline' },
  { kind: 'shaken', icon: 'shield-checkmark-outline' },
  { kind: 'insurance', icon: 'document-text-outline' },
  { kind: 'car_tax', icon: 'receipt-outline' },
  { kind: 'parking_toll', icon: 'car-outline' },
  { kind: 'loan_lease', icon: 'card-outline' },
  { kind: 'other', icon: 'ellipsis-horizontal-circle-outline' },
  { kind: 'odometer', icon: 'analytics-outline' },
];

export function kindLabel(kind: RecordKind): string {
  return kind === 'odometer' ? '走行距離だけ' : EXPENSE_CATEGORY_LABELS[kind];
}

export function KindPicker({ onSelect }: { onSelect: (k: RecordKind) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {KINDS.map(({ kind, icon }) => (
        <Pressable
          key={kind}
          accessibilityRole="button"
          accessibilityLabel={`${kindLabel(kind)}を記録する`}
          onPress={() => onSelect(kind)}
          style={({ pressed }) => ({
            width: '31%',
            minHeight: 88,
            borderRadius: radius.card,
            backgroundColor: colors.card,
            ...cardShadow,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: spacing.sm,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={22} color={colors.accent} />
          </View>
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.text, textAlign: 'center' }}>{kindLabel(kind)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export type EditTarget =
  | { type: 'oil'; row: OilChangeRow; expense: ExpenseRow | null }
  | { type: 'expense'; row: ExpenseRow }
  | { type: 'odometer'; row: OdometerReadingRow };

function confirmWarnings(messages: string[]): Promise<boolean> {
  if (messages.length === 0) return Promise.resolve(true);
  return new Promise((resolve) =>
    Alert.alert('入力を確認してください', messages.join('\n\n'), [
      { text: '修正する', style: 'cancel', onPress: () => resolve(false) },
      { text: 'このまま登録', onPress: () => resolve(true) },
    ]),
  );
}

export function RecordForm({
  bundle,
  kind,
  target,
  onSaved,
}: {
  bundle: VehicleBundle;
  kind: RecordKind;
  target?: EditTarget;
  onSaved: () => void;
}) {
  const invalidate = useInvalidate();
  const initialDate =
    target?.type === 'oil' ? target.row.performed_on : target?.type === 'expense' ? target.row.spent_on : target?.type === 'odometer' ? target.row.read_on : bundle.today;
  const initialOdo = target?.type === 'oil' || target?.type === 'odometer' ? target.row.odo_km : target?.type === 'expense' ? target.row.odo_km : null;
  const initialAmount = target?.type === 'oil' ? target.expense?.amount_yen : target?.type === 'expense' ? target.row.amount_yen : null;

  const [date, setDate] = useState<string>(initialDate);
  const [odo, setOdo] = useState(initialOdo != null ? String(initialOdo) : '');
  const [amount, setAmount] = useState(initialAmount != null ? String(initialAmount) : '');
  const [filterChanged, setFilterChanged] = useState(target?.type === 'oil' ? target.row.filter_changed : false);
  const [note, setNote] = useState(target?.type === 'expense' ? (target.row.note ?? '') : '');
  const [busy, setBusy] = useState(false);

  const isOil = kind === 'oil_change';
  const isOdoOnly = kind === 'odometer';
  const odoKm = parseInteger(odo);
  const amountYen = parseInteger(amount);
  const odoRequired = isOil || isOdoOnly;
  const amountRequired = !isOil && !isOdoOnly;

  const odoValid = odoKm == null ? !odoRequired : Number.isFinite(odoKm) && odoKm <= 2_000_000;
  const amountValid = amountYen == null ? !amountRequired : Number.isFinite(amountYen) && amountYen > 0 && amountYen < 100_000_000;
  const valid = !!date && odoValid && amountValid;

  const save = async () => {
    if (!valid) return;
    if (odoKm != null) {
      // 編集中の記録自身とは比べない
      const others = bundle.points
        .filter((p) => !(initialOdo != null && p.date === initialDate && p.odo_km === initialOdo))
        .map((p) => ({ date: p.date, odoKm: p.odo_km }));
      const replacements = bundle.meterReplacements.map((m) => ({
        replacedOn: m.replaced_on,
        odoBeforeKm: m.odo_before_km,
        odoAfterKm: m.odo_after_km,
      }));
      const warnings = checkOdoEntry({ date, odoKm }, others, replacements);
      if (!(await confirmWarnings(warnings.map((w) => w.message)))) return;
    }
    setBusy(true);
    try {
      const vehicleId = bundle.vehicle.id;
      if (isOil) {
        await saveOilChange({
          id: target?.type === 'oil' ? target.row.id : undefined,
          vehicleId,
          date,
          odoKm: odoKm!,
          oilChanged: true,
          filterChanged,
          amountYen,
        });
      } else if (isOdoOnly) {
        await saveOdoReading({ id: target?.type === 'odometer' ? target.row.id : undefined, vehicleId, date, odoKm: odoKm! });
      } else {
        await saveExpense({
          id: target?.type === 'expense' ? target.row.id : undefined,
          vehicleId,
          category: kind,
          date,
          amountYen: amountYen!,
          odoKm,
          note: note.trim() || null,
        });
      }
      await invalidate();
      onSaved();
      if (kind === 'shaken' && !target) {
        Alert.alert('車検の満了日も更新しますか', '新しい満了日を登録すると、前の満了日の通知と警告が止まります。', [
          { text: 'あとで', style: 'cancel' },
          { text: '登録する', onPress: () => router.push('/settings/deadlines') },
        ]);
      }
    } catch (e) {
      Alert.alert('保存できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <AppText variant="heading">{kindLabel(kind)}</AppText>
        <DateField label="日付" value={date} onChange={(v) => v && setDate(v)} />
        <Field
          label={odoRequired ? '走行距離（ODO）' : '走行距離（ODO・任意）'}
          value={odo}
          onChangeText={setOdo}
          keyboardType="number-pad"
          suffix="km"
          hint={odoKm != null && !Number.isFinite(odoKm) ? '数字で入力してください' : undefined}
        />
        {!isOdoOnly && (
          <Field
            label={isOil ? '金額（任意）' : '金額'}
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            suffix="円"
            hint={isOil ? '入力すると維持費に1件として数えます。' : undefined}
          />
        )}
        {isOil && (
          <ToggleRow
            title="フィルターも交換した"
            description="オイルフィルターは別の周期で管理し、通知も別に出します。"
            value={filterChanged}
            onChange={setFilterChanged}
          />
        )}
        {!isOil && !isOdoOnly && <Field label="メモ（任意）" value={note} onChangeText={setNote} maxLength={200} />}
        {kind === 'maintenance' && (
          <AppText variant="caption">オイル交換は「オイル交換」から記録してください（金額が二重に数えられるのを防ぐため）。</AppText>
        )}
      </Card>
      <Button title={target ? '保存する' : '記録する'} disabled={!valid} loading={busy} onPress={save} />
    </View>
  );
}

