import { useLocalSearchParams, router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { EXPENSE_CATEGORIES } from '@domain/costs.ts';
import { KindPicker, kindLabel, RecordForm, type RecordKind } from '../../components/RecordForm';
import { AppText, Button, ErrorView, ListRow, Loading, Screen, Card } from '../../components/ui';
import { useVehicleBundle } from '../../lib/data';

function isKind(v: unknown): v is RecordKind {
  return v === 'odometer' || (typeof v === 'string' && (EXPENSE_CATEGORIES as readonly string[]).includes(v));
}

export default function Record() {
  const params = useLocalSearchParams<{ category?: string }>();
  const { bundle } = useVehicleBundle();
  const [selected, setSelected] = useState<RecordKind | null>(null);
  const [formKey, setFormKey] = useState(0);
  // ホームの「オイル交換を記録する」から来た場合は、その項目を選んだ状態で開く
  const kind = isKind(params.category) ? params.category : selected;
  const setKind = (k: RecordKind | null) => {
    if (params.category) router.setParams({ category: undefined });
    setSelected(k);
  };

  if (bundle.isPending) return <Loading />;
  if (bundle.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;

  return (
    <Screen>
      {kind == null ? (
        <>
          <AppText variant="label">何を記録しますか</AppText>
          <KindPicker onSelect={setKind} />
          <Card style={{ paddingVertical: 4 }}>
            <ListRow title="記録の一覧" detail="編集・削除はこちらから" onPress={() => router.push('/records')} />
          </Card>
        </>
      ) : (
        <>
          <RecordForm
            key={`${kind}-${formKey}`}
            bundle={bundle.data}
            kind={kind}
            onSaved={() => {
              Alert.alert('記録しました', `${kindLabel(kind)}を記録しました。`);
              setKind(null);
              setFormKey((k) => k + 1);
            }}
          />
          <Button title="項目を選び直す" variant="plain" onPress={() => setKind(null)} />
        </>
      )}
    </Screen>
  );
}
