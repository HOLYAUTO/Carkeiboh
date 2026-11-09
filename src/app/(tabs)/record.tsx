import { router } from 'expo-router';
import { KindPicker } from '../../components/RecordForm';
import { AppText, Card, Divider, IconButton, ListRow, Screen, ScreenHeader } from '../../components/ui';

/** 項目を選ぶと入力画面（/records/new）を開く。入力画面からは「戻る」やスワイプでここに戻れる */
export default function Record() {
  return (
    <Screen header={<ScreenHeader tag="RECORD" title="記録する" right={<IconButton icon="settings-outline" label="設定" onPress={() => router.push('/settings')} />} />}>
      <AppText variant="label">何を記録しますか</AppText>
      <AppText variant="caption">入力画面では、写真（レシート・メーター）や音声からも入力できます。</AppText>
      <KindPicker onSelect={(kind) => router.push({ pathname: '/records/new', params: { kind } })} />
      <Card style={{ paddingVertical: 4 }}>
        <ListRow title="レシートをまとめて取り込む" detail="アルバムから何枚か選んで一度に登録" onPress={() => router.push('/records/receipts')} />
        <Divider />
        <ListRow title="掛けカードの明細から給油をまとめて登録" detail="月の明細の写真を読み取ります" onPress={() => router.push('/records/fuel-statement')} />
        <Divider />
        <ListRow title="記録の一覧" detail="編集・削除はこちらから" onPress={() => router.push('/records')} />
      </Card>
    </Screen>
  );
}
