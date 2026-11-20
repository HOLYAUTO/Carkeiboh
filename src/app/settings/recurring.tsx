import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { EXPENSE_CATEGORY_LABELS } from '@domain/costs.ts';
import { AppText, Button, Card, Divider, ErrorView, Field, ListRow, Loading, Screen, SectionTitle, Segmented } from '../../components/ui';
import {
  deleteRecurringExpense,
  saveRecurringExpense,
  useInvalidate,
  useRecurringExpenses,
  useVehicleBundle,
  type RecurringCategory,
  type RecurringExpenseRow,
  type VehicleBundle,
} from '../../lib/data';
import { fullDate, parseInteger, yen } from '../../lib/format';
import { amountFor, nextDue, RECURRING_CATEGORIES, recurringLabel, scheduleLabel } from '../../lib/recurring';
import { fonts, MIN_TAP, radius, spacing, useColors } from '../../theme';

const FREQUENCY_OPTIONS: { value: 'monthly' | 'yearly'; label: string }[] = [
  { value: 'monthly', label: '毎月' },
  { value: 'yearly', label: '毎年' },
];

/**
 * 決まった支出（保険・ローン・月極駐車場・自動車税など）の登録。
 * その日が来たらホームに「記録する／飛ばす」を出す（勝手には記録しない）
 */
export default function RecurringScreen() {
  const { bundle } = useVehicleBundle();
  const recurring = useRecurringExpenses(bundle.data?.vehicle);
  if (bundle.isPending || recurring.isPending) return <Loading />;
  if (bundle.isError || recurring.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => recurring.refetch()} />;
  return <RecurringList bundle={bundle.data} rules={recurring.data.rules} />;
}

function RecurringList({ bundle, rules }: { bundle: VehicleBundle; rules: RecurringExpenseRow[] }) {
  const [editing, setEditing] = useState<RecurringExpenseRow | 'new' | null>(rules.length === 0 ? 'new' : null);
  return (
    <Screen>
      <AppText>毎月・毎年決まって払うものを登録しておくと、その日が来たらホームで「記録する」を押すだけで記録できます。</AppText>
      {rules.length > 0 && (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {rules.map((r, i) => {
            const next = nextDue(r, bundle.today);
            const amount = next ? amountFor(r, next, bundle.vehicle) : r.amount_yen;
            return (
              <View key={r.id}>
                {i > 0 && <Divider />}
                <ListRow
                  title={`${recurringLabel(r)}　${amount != null ? yen(amount) : '自動で計算'}`}
                  detail={`${scheduleLabel(r)}${next ? `・次は ${fullDate(next)}` : ''}`}
                  onPress={() => setEditing(r)}
                />
              </View>
            );
          })}
        </Card>
      )}
      {editing ? (
        <RecurringForm key={editing === 'new' ? 'new' : editing.id} bundle={bundle} target={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      ) : (
        <Button title="決まった支出を追加する" variant="secondary" onPress={() => setEditing('new')} />
      )}
    </Screen>
  );
}

function RecurringForm({ bundle, target, onDone }: { bundle: VehicleBundle; target: RecurringExpenseRow | null; onDone: () => void }) {
  const colors = useColors();
  const invalidate = useInvalidate();
  const [category, setCategory] = useState<RecurringCategory>(target?.category ?? 'insurance');
  const [amount, setAmount] = useState(target?.amount_yen != null ? String(target.amount_yen) : '');
  const [frequency, setFrequency] = useState<'monthly' | 'yearly'>(target?.frequency ?? 'monthly');
  const [month, setMonth] = useState(target?.month_of_year != null ? String(target.month_of_year) : category === 'car_tax' ? '5' : '');
  const [day, setDay] = useState(target ? String(target.day_of_month) : '');
  const [note, setNote] = useState(target?.note ?? '');
  const [busy, setBusy] = useState(false);

  const amountN = parseInteger(amount);
  const monthN = parseInteger(month);
  const dayN = parseInteger(day);
  const isCarTax = category === 'car_tax';
  const amountOk = amountN == null ? isCarTax : Number.isFinite(amountN) && amountN > 0 && amountN < 100_000_000;
  const monthOk = frequency === 'monthly' || (monthN != null && monthN >= 1 && monthN <= 12);
  const dayOk = dayN != null && dayN >= 1 && dayN <= 31;
  const valid = amountOk && monthOk && dayOk;

  const chooseCategory = (c: RecurringCategory) => {
    setCategory(c);
    // 自動車税は毎年5月（納付書の期限は県によって5月末か6月末）
    if (c === 'car_tax' && !target) {
      setFrequency('yearly');
      if (!month) setMonth('5');
      if (!day) setDay('31');
    }
  };

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await saveRecurringExpense({
        id: target?.id,
        vehicle_id: bundle.vehicle.id,
        category,
        amount_yen: amountN,
        frequency,
        month_of_year: frequency === 'yearly' ? monthN : null,
        day_of_month: dayN!,
        starts_on: target?.starts_on ?? bundle.today,
        ends_on: target?.ends_on ?? null,
        note: note.trim() || null,
      });
      await invalidate();
      onDone();
    } catch (e) {
      Alert.alert('保存できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    Alert.alert('この決まった支出を消しますか', 'これまでに記録した支出は消えません。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '消す',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteRecurringExpense(target!.id);
          } catch (e) {
            Alert.alert('消せませんでした', e instanceof Error ? e.message : String(e));
            return;
          }
          await invalidate();
          onDone();
        },
      },
    ]);

  return (
    <>
      <SectionTitle>{target ? '決まった支出を直す' : '決まった支出を追加する'}</SectionTitle>
      <Card>
        <AppText variant="label">項目</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {RECURRING_CATEGORIES.map((c) => {
            const on = c === category;
            return (
              <Pressable
                key={c}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => chooseCategory(c)}
                style={{ minHeight: MIN_TAP, paddingHorizontal: spacing.md, borderRadius: radius.control, justifyContent: 'center', backgroundColor: on ? colors.accent : colors.accentSoft }}
              >
                <Text style={{ fontFamily: fonts.medium, color: on ? colors.onAccent : colors.accentText }}>{EXPENSE_CATEGORY_LABELS[c]}</Text>
              </Pressable>
            );
          })}
        </View>
        <Field
          label={isCarTax ? '金額（空欄なら自動で計算）' : '金額'}
          value={amount}
          onChangeText={setAmount}
          keyboardType="number-pad"
          suffix="円"
          hint={isCarTax && amountN == null ? '車検証の内容から計算した税額を使います。' : undefined}
        />
        <AppText variant="label">いつ</AppText>
        <Segmented options={FREQUENCY_OPTIONS} value={frequency} onChange={setFrequency} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {frequency === 'yearly' && (
            <View style={{ flex: 1 }}>
              <Field label="月" value={month} onChangeText={setMonth} keyboardType="number-pad" suffix="月" />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Field label="日" value={day} onChangeText={setDay} keyboardType="number-pad" suffix="日" hint={dayN != null && dayN > 28 ? 'その月に無い日は月末にします。' : undefined} />
          </View>
        </View>
        <Field label="名前・メモ（任意）" value={note} onChangeText={setNote} maxLength={200} placeholder="例：月極駐車場、〇〇保険" />
      </Card>
      <Button title="保存する" disabled={!valid} loading={busy} onPress={save} />
      <Button title="やめる" variant="secondary" disabled={busy} onPress={onDone} />
      {target && <Button title="この決まった支出を消す" variant="destructive" disabled={busy} onPress={remove} />}
    </>
  );
}
