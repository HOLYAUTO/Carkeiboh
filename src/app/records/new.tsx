import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import { EXPENSE_CATEGORIES } from '@domain/costs.ts';
import { isWearKind, kindLabel, RecordForm, type RecordKind } from '../../components/RecordForm';
import { ErrorView, Loading, Screen } from '../../components/ui';
import { useVehicleBundle } from '../../lib/data';

function isKind(v: unknown): v is RecordKind {
  return typeof v === 'string' && (v === 'odometer' || isWearKind(v) || (EXPENSE_CATEGORIES as readonly string[]).includes(v));
}

/**
 * 記録の入力。「記録する」タブで選んだ項目をスタックの画面として開くので、
 * 左上の「戻る」・横スワイプ・Android の戻る操作で、項目選びにすぐ戻れる。
 */
export default function NewRecord() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const { bundle } = useVehicleBundle();

  if (!isKind(kind)) return <ErrorView message="記録する項目が見つかりません。" onRetry={() => router.back()} />;
  if (bundle.isPending) return <Loading />;
  if (bundle.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;

  // 保存した直後に入力ミスに気づいたら、その場で編集画面へ進める
  const onSaved = (recordRef: string) => {
    const fix = { text: '内容を直す', onPress: () => router.replace({ pathname: '/records/[id]', params: { id: recordRef } }) };
    if (kind === 'shaken') {
      Alert.alert('記録しました', '車検の満了日も更新しますか。新しい満了日を登録すると、前の満了日の通知と警告が止まります。', [
        fix,
        { text: 'あとで', style: 'cancel', onPress: () => router.back() },
        { text: '満了日を登録する', onPress: () => router.replace('/settings/deadlines') },
      ]);
      return;
    }
    Alert.alert('記録しました', `${kindLabel(kind)}を記録しました。`, [fix, { text: 'OK', style: 'cancel', onPress: () => router.back() }]);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: kindLabel(kind) }} />
      <RecordForm bundle={bundle.data} kind={kind} onSaved={onSaved} />
    </Screen>
  );
}
