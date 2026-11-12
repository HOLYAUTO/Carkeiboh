import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { DEADLINE_LABELS, DEADLINE_RENEW_MONTHS, renewedDueOn, renewLabel, type DeadlineKind } from '@domain/reminders.ts';
import { AppText, Button, Card, DateField, ErrorView, Loading, Screen } from '../../components/ui';
import { registerDeadline, removeDeadline, useInvalidate, useVehicleBundle, type DeadlineRow } from '../../lib/data';
import { daysLeft, fullDate } from '../../lib/format';
import { diffDays } from '@domain/dates.ts';
import { fonts, MIN_TAP, radius, spacing, useColors } from '../../theme';

const KINDS: { kind: DeadlineKind; hint: string }[] = [
  { kind: 'shaken', hint: '車検を受けたら、新しい満了日を登録してください。前の満了日の通知と警告が止まります。' },
  { kind: 'inspection_legal', hint: '法定点検（12か月点検・24か月点検）の予定日。点検を受けたら次の予定日を登録してください。' },
  { kind: 'inspection_voluntary', hint: '任意の点検の予定日。車検の警告とは別に管理します。' },
  { kind: 'insurance', hint: '更新したら新しい満期日を登録してください。旧契約の通知が止まります。' },
];

export default function Deadlines() {
  const { bundle } = useVehicleBundle();
  if (bundle.isPending) return <Loading />;
  if (bundle.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;
  return (
    <Screen>
      {KINDS.map(({ kind, hint }) => (
        <DeadlineCard
          key={kind}
          kind={kind}
          hint={hint}
          vehicleId={bundle.data.vehicle.id}
          today={bundle.data.today}
          current={bundle.data.deadlines.find((d) => d.kind === kind) ?? null}
        />
      ))}
    </Screen>
  );
}

/** ワンタッチ更新のあと、取り消せるように前の期限を覚えておく（null は未登録だった） */
type Undo = { previous: string | null; renewedTo: string };

function DeadlineCard({ kind, hint, vehicleId, today, current }: { kind: DeadlineKind; hint: string; vehicleId: string; today: string; current: DeadlineRow | null }) {
  const colors = useColors();
  const invalidate = useInvalidate();
  const [date, setDate] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | 'date' | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const days = current ? diffDays(today, current.due_on) : null;

  const register = async (dueOn: string, by: number | 'date') => {
    setBusy(by);
    try {
      await registerDeadline(vehicleId, kind, dueOn);
      await invalidate();
      return true;
    } catch (e) {
      Alert.alert('登録できませんでした', e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!date) return;
    if (await register(date, 'date')) {
      setDate(null);
      setUndo(null);
    }
  };

  const renew = async (months: number) => {
    const next = renewedDueOn(current?.due_on ?? null, months, today);
    const previous = current?.due_on ?? null;
    if (await register(next, months)) setUndo({ previous, renewedTo: next });
  };

  const revert = async () => {
    if (!undo) return;
    try {
      if (undo.previous) {
        await registerDeadline(vehicleId, kind, undo.previous);
      } else if (current) {
        await removeDeadline(current.id);
      }
      await invalidate();
      setUndo(null);
    } catch (e) {
      Alert.alert('元に戻せませんでした', e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async () => {
    if (!current) return;
    try {
      await removeDeadline(current.id);
      await invalidate();
      setUndo(null);
    } catch (e) {
      Alert.alert('削除できませんでした', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card>
      <AppText variant="heading">{DEADLINE_LABELS[kind]}</AppText>
      {current ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <AppText>{fullDate(current.due_on)}</AppText>
          <AppText style={{ color: days! < 0 ? colors.caution : colors.text }}>{days! < 0 ? `期限切れ・${daysLeft(days!)}` : daysLeft(days!)}</AppText>
        </View>
      ) : (
        <AppText variant="caption">未登録</AppText>
      )}
      <AppText variant="caption">{hint}</AppText>

      <AppText variant="caption">{current ? 'ワンタッチで更新（今の期限から数えます）' : 'ワンタッチで登録（今日から数えます）'}</AppText>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {DEADLINE_RENEW_MONTHS[kind].map((months) => (
          <RenewButton
            key={months}
            label={renewLabel(months)}
            date={renewedDueOn(current?.due_on ?? null, months, today)}
            loading={busy === months}
            disabled={busy !== null}
            onPress={() => renew(months)}
          />
        ))}
      </View>
      {undo && current?.due_on === undo.renewedTo && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
          <AppText variant="caption" style={{ flex: 1 }}>
            {fullDate(undo.renewedTo)} に更新しました
          </AppText>
          <Button title={undo.previous ? `元に戻す（${fullDate(undo.previous)}）` : '元に戻す'} variant="plain" onPress={revert} />
        </View>
      )}

      <DateField label={current ? 'ほかの日付で更新' : 'ほかの日付で登録'} value={date} onChange={setDate} optional />
      <View style={{ gap: spacing.sm }}>
        {date && <Button title={current ? 'この日付で更新する' : 'この日付で登録する'} loading={busy === 'date'} disabled={busy !== null} onPress={save} />}
        {current && <Button title="登録を取り消す" variant="plain" onPress={remove} />}
      </View>
    </Card>
  );
}

/** 「1年後」と、その結果の日付を2行で見せる。押したらすぐ登録する */
function RenewButton({ label, date, loading, disabled, onPress }: { label: string; date: string; loading: boolean; disabled: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}の${fullDate(date)}で更新`}
      accessibilityState={{ disabled, busy: loading }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: MIN_TAP + 12,
        borderRadius: radius.control,
        backgroundColor: colors.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.sm,
        opacity: pressed ? 0.7 : disabled && !loading ? 0.4 : 1,
      })}
    >
      <AppText style={{ color: colors.accentText, fontFamily: fonts.semibold, fontSize: 16 }}>{loading ? '登録中…' : label}</AppText>
      <AppText variant="caption" style={{ color: colors.accentText }}>{fullDate(date)}</AppText>
    </Pressable>
  );
}
