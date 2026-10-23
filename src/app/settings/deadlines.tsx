import { useState } from 'react';
import { Alert, View } from 'react-native';
import { DEADLINE_LABELS, type DeadlineKind } from '@domain/reminders.ts';
import { AppText, Button, Card, DateField, ErrorView, Loading, Screen } from '../../components/ui';
import { registerDeadline, removeDeadline, useInvalidate, useVehicleBundle, type DeadlineRow } from '../../lib/data';
import { daysLeft, fullDate } from '../../lib/format';
import { diffDays } from '@domain/dates.ts';
import { colors, spacing } from '../../theme';

const KINDS: { kind: DeadlineKind; hint: string }[] = [
  { kind: 'shaken', hint: '車検を受けたら、新しい満了日を登録してください。前の満了日の通知と警告が止まります。' },
  { kind: 'inspection_legal', hint: '法定点検（12か月点検など）の予定日。' },
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

function DeadlineCard({ kind, hint, vehicleId, today, current }: { kind: DeadlineKind; hint: string; vehicleId: string; today: string; current: DeadlineRow | null }) {
  const invalidate = useInvalidate();
  const [date, setDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const days = current ? diffDays(today, current.due_on) : null;

  const save = async () => {
    if (!date) return;
    setBusy(true);
    try {
      await registerDeadline(vehicleId, kind, date);
      await invalidate();
      setDate(null);
    } catch (e) {
      Alert.alert('登録できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!current) return;
    try {
      await removeDeadline(current.id);
      await invalidate();
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
      <DateField label={current ? '新しい日付を登録' : '日付を登録'} value={date} onChange={setDate} optional />
      <View style={{ gap: spacing.sm }}>
        <Button title={current ? '更新を登録する' : '登録する'} disabled={!date} loading={busy} onPress={save} />
        {current && <Button title="登録を取り消す" variant="plain" onPress={remove} />}
      </View>
    </Card>
  );
}
