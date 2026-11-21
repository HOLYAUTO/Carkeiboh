import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { handleRecurringExpense, useInvalidate, useRecurringExpenses, type VehicleBundle } from '../lib/data';
import { fullDate, yen } from '../lib/format';
import { dueItems, recurringLabel } from '../lib/recurring';
import { spacing } from '../theme';
import { AppText, Button, Card, Divider } from './ui';
import { alertError } from '../lib/alerts';

/** ホームの「決まった支出」。その日が来た回を、金額を入れた状態で「記録する／飛ばす」だけにする */
export function RecurringPrompt({ data }: { data: VehicleBundle }) {
  const recurring = useRecurringExpenses(data.vehicle);
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState<string | null>(null);
  if (!recurring.data) return null;
  const items = dueItems(recurring.data, data.today, data.vehicle);
  if (items.length === 0) return null;

  const act = async (key: string, run: () => Promise<void>) => {
    setBusy(key);
    try {
      await run();
      await invalidate();
    } catch (e) {
      alertError('保存できませんでした', e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <AppText variant="heading">決まった支出</AppText>
      {items.map((item, i) => {
        const key = `${item.rule.id}:${item.dueOn}`;
        return (
          <View key={key} style={{ gap: spacing.xs }}>
            {i > 0 && <Divider />}
            <AppText>{`${recurringLabel(item.rule)}（${fullDate(item.dueOn)}）`}</AppText>
            <AppText variant="caption">{item.amountYen != null ? yen(item.amountYen) : '金額を計算できません（車検証の内容を入れてください）'}</AppText>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                {item.amountYen != null ? (
                  <Button
                    title="記録する"
                    loading={busy === key}
                    disabled={busy != null}
                    onPress={() => act(key, () => handleRecurringExpense(item.rule.id, item.dueOn, true, item.amountYen))}
                  />
                ) : (
                  <Button title="車検証の内容を入れる" variant="secondary" onPress={() => router.push('/settings/certificate')} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="今回は飛ばす"
                  variant="secondary"
                  disabled={busy != null}
                  onPress={() => act(key, () => handleRecurringExpense(item.rule.id, item.dueOn, false, null))}
                />
              </View>
            </View>
          </View>
        );
      })}
      <AppText variant="caption">金額が違うときは、記録したあとに「記録の一覧」から直せます。</AppText>
    </Card>
  );
}
