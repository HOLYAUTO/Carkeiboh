import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import { EXPENSE_CATEGORIES } from '@domain/costs.ts';
import { isWearKind, kindLabel, RecordForm, type RecordKind } from '../../components/RecordForm';
import { ErrorView, Loading, Screen } from '../../components/ui';
import type { RecordDraft } from '@shared/record-draft.ts';
import { useVehicleBundle } from '../../lib/data';

function parseDraft(json: string | undefined): RecordDraft | undefined {
  if (!json) return undefined;
  try {
    // 画面のあいだで受け渡すだけなので、範囲の確認はサーバーの sanitizeDraft に任せる（入力欄に入れたあと利用者が確かめる）
    const d = JSON.parse(json) as RecordDraft;
    return d && typeof d === 'object' ? d : undefined;
  } catch {
    return undefined;
  }
}

function isKind(v: unknown): v is RecordKind {
  return typeof v === 'string' && (v === 'odometer' || isWearKind(v) || (EXPENSE_CATEGORIES as readonly string[]).includes(v));
}

/**
 * 記録の入力。「記録する」タブで選んだ項目をスタックの画面として開くので、
 * 左上の「戻る」・横スワイプ・Android の戻る操作で、項目選びにすぐ戻れる。保存しても元の画面に戻る。
 */
export default function NewRecord() {
  // station：ホームの「給油を記録する」・スタンドを出たときの通知から開いたときのスタンド名（メモに入れる）
  // draft：レシートをまとめて取り込む画面から、読み取った内容を入れた状態で開くとき（JSON）
  const { kind, station, draft } = useLocalSearchParams<{ kind?: string; station?: string; draft?: string }>();
  const initialDraft = parseDraft(draft);
  const { bundle } = useVehicleBundle();

  if (!isKind(kind)) return <ErrorView message="記録する項目が見つかりません。" onRetry={() => router.back()} />;
  if (bundle.isPending) return <Loading />;
  if (bundle.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;

  // 保存したら、開く前の画面（「記録する」タブかホーム）にすぐ戻り、そこで「記録しました」と知らせる。
  // 入力ミスに気づいたら、知らせの「内容を直す」から編集画面へ進める（直して保存すると、また元の画面に戻る）
  const onSaved = (recordRef: string) => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
    const fix = { text: '内容を直す', onPress: () => router.push({ pathname: '/records/[id]', params: { id: recordRef } }) };
    if (kind === 'shaken') {
      Alert.alert('記録しました', '車検の満了日も更新しますか。新しい満了日を登録すると、前の満了日の通知と警告が止まります。', [
        fix,
        { text: 'あとで', style: 'cancel' },
        { text: '満了日を登録する', onPress: () => router.push('/settings/deadlines') },
      ]);
      return;
    }
    Alert.alert('記録しました', `${kindLabel(kind)}を記録しました。`, [fix, { text: 'OK', style: 'cancel' }]);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: kindLabel(kind) }} />
      <RecordForm bundle={bundle.data} kind={kind} onSaved={onSaved} prefill={station ? { note: station.slice(0, 60) } : undefined} initialDraft={initialDraft} />
    </Screen>
  );
}
