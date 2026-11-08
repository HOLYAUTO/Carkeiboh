import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from '@domain/costs.ts';
import { FUEL_TYPE_LABELS } from '@domain/fuel.ts';
import type { RecordDraft } from '@shared/record-draft.ts';
import { AppText, Badge, Button, Card, Divider, ErrorView, Loading, Notice, Num, Screen } from '../../components/ui';
import { PAID_NOW, saveExpense, useInvalidate, useVehicleBundle, vehicleUnit, type VehicleBundle } from '../../lib/data';
import { fullDate, yen } from '../../lib/format';
import { pickPhotos } from '../../lib/photo';
import { batchStatus, isDuplicate, type BatchStatus } from '../../lib/receipt-batch';
import { invokeFunction } from '../../lib/supabase';
import { radius, spacing, useColors } from '../../theme';

const PHOTO_MAX_SIDE = 1600;
const MAX_PHOTOS = 10;

interface Item {
  key: string;
  uri: string;
  draft: RecordDraft | null;
  status: BatchStatus;
  duplicate: boolean;
  selected: boolean;
  /** 開いて入力・登録した */
  done: boolean;
}

/**
 * ためておいたレシートをまとめて取り込む。アルバムから何枚か選ぶと1枚ずつ読み取り、
 * そのまま登録できるものは一覧で確かめて一度に登録する。足りないものは1枚ずつ開いて入力する
 */
export default function ReceiptsScreen() {
  const { bundle } = useVehicleBundle();
  if (bundle.isPending) return <Loading />;
  if (bundle.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;
  return <Receipts bundle={bundle.data} />;
}

function Receipts({ bundle }: { bundle: VehicleBundle }) {
  const colors = useColors();
  const invalidate = useInvalidate();
  const [items, setItems] = useState<Item[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unit = vehicleUnit(bundle.vehicle);
  // ホーム画面のアイコンの長押し（レシートを撮る）から開いたときは、すぐカメラを開く
  const { camera } = useLocalSearchParams<{ camera?: string }>();
  const openedCamera = useRef(false);

  const read = async (source: 'camera' | 'library') => {
    const photos = await pickPhotos(source, { maxSide: PHOTO_MAX_SIDE, multiple: true, limit: MAX_PHOTOS });
    if (photos.length === 0) return;
    const added: Item[] = [];
    for (const [i, photo] of photos.entries()) {
      setProgress(`${i + 1} / ${photos.length} 枚目を読み取っています…`);
      let draft: RecordDraft | null = null;
      try {
        const { odoKm, ...d } = await invokeFunction<RecordDraft & { odoKm?: number }>('read-record-photo', { image: photo.base64, unit });
        draft = { ...d, odo: d.odo ?? odoKm };
      } catch {
        draft = null;
      }
      const status = batchStatus(draft);
      const duplicate = status === 'ready' && isDuplicate(draft!, bundle.expenses);
      added.push({ key: `${Date.now()}-${i}`, uri: photo.uri, draft, status, duplicate, selected: status === 'ready' && !duplicate, done: false });
    }
    setProgress(null);
    setItems((prev) => [...prev, ...added]);
  };

  useEffect(() => {
    if (camera === '1' && !openedCamera.current) {
      openedCamera.current = true;
      read('camera');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  const toggle = (key: string) => setItems((prev) => prev.map((it) => (it.key === key && it.status === 'ready' && !it.done ? { ...it, selected: !it.selected } : it)));
  const selected = items.filter((it) => it.selected && !it.done);

  const openOne = (it: Item) => {
    const kind = it.draft?.category && it.draft.category !== 'odometer' ? it.draft.category : (it.draft?.category ?? 'other');
    setItems((prev) => prev.map((x) => (x.key === it.key ? { ...x, done: true, selected: false } : x)));
    router.push({ pathname: '/records/new', params: { kind, draft: JSON.stringify(it.draft ?? {}) } });
  };

  const save = async () => {
    setBusy(true);
    let saved = 0;
    try {
      for (const it of selected) {
        const d = it.draft!;
        const category = d.category as Exclude<ExpenseCategory, 'oil_change'>;
        await saveExpense({
          vehicleId: bundle.vehicle.id,
          category,
          date: d.date!,
          amountYen: d.amountYen!,
          odoKm: null,
          note: d.note?.slice(0, 200) ?? null,
          fuel:
            category === 'fuel'
              ? {
                  liters: d.fuelLiters ?? null,
                  unitPrice: d.fuelUnitPrice ?? null,
                  priceBasis: d.fuelUnitPrice != null ? 'tax_included' : null,
                  fuelType: d.fuelType ?? null,
                  // 走行距離が無いので燃費には使わない
                  fullTank: false,
                }
              : null,
          payment: PAID_NOW,
        });
        saved += 1;
        setItems((prev) => prev.map((x) => (x.key === it.key ? { ...x, done: true, selected: false } : x)));
      }
      await invalidate();
      Alert.alert('登録しました', `${saved}件を登録しました。`);
    } catch (e) {
      await invalidate();
      Alert.alert('途中で保存できませんでした', `${saved}件は登録しました。${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <AppText>レシートを撮るか、ためておいたレシートの写真を選ぶと、読み取って登録します（アルバムからは一度に{MAX_PHOTOS}枚まで）。</AppText>
      <Button title="レシートを撮る" variant={items.length > 0 ? 'secondary' : 'primary'} loading={!!progress} onPress={() => read('camera')} />
      <Button title={items.length > 0 ? 'さらにアルバムから選ぶ' : 'アルバムから選ぶ（何枚でも）'} variant="secondary" disabled={!!progress} onPress={() => read('library')} />
      {progress && <AppText variant="caption">{progress}</AppText>}
      {items.length > 0 && <Notice title="読み取った内容を確認してください">写真と見比べてから登録してください。足りないものは「開いて入力」から1枚ずつ入れられます。</Notice>}
      {items.length > 0 && (
        <Card>
          {items.map((it, i) => {
            const d = it.draft;
            const detail = d
              ? [
                  d.date ? fullDate(d.date) : '日付なし',
                  d.category && d.category !== 'odometer' ? EXPENSE_CATEGORY_LABELS[d.category] : d.category === 'odometer' ? '走行距離' : '項目なし',
                  d.fuelLiters != null ? `${d.fuelLiters}L` : null,
                  d.fuelType ? FUEL_TYPE_LABELS[d.fuelType] : null,
                  d.note ?? null,
                ]
                  .filter(Boolean)
                  .join('・')
              : '読み取れませんでした';
            return (
              <View key={it.key}>
                {i > 0 && <Divider />}
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: it.selected, disabled: it.status !== 'ready' || it.done }}
                  onPress={() => toggle(it.key)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}
                >
                  {it.status === 'ready' && !it.done ? (
                    <Ionicons name={it.selected ? 'checkbox' : 'square-outline'} size={22} color={it.selected ? colors.accent : colors.textSecondary} />
                  ) : (
                    <View style={{ width: 22 }} />
                  )}
                  <Image source={{ uri: it.uri }} style={{ width: 44, height: 44, borderRadius: radius.control }} contentFit="cover" />
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="caption">{detail}</AppText>
                    {it.done && <Badge label="登録済み" tone="accent" />}
                    {!it.done && it.duplicate && <Badge label="登録済みと思われます" tone="neutral" />}
                    {!it.done && it.status === 'needs_input' && <Button title="開いて入力" variant="plain" onPress={() => openOne(it)} />}
                  </View>
                  <Num>{d?.amountYen != null ? yen(d.amountYen) : '—'}</Num>
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}
      {selected.length > 0 && <Button title={`${selected.length}件を登録する`} loading={busy} onPress={save} />}
      <AppText variant="caption">写真は読み取りだけに使い、保存しません。オイル交換・走行距離のレシートは、走行距離を入れるため1枚ずつ開いて入力します。</AppText>
    </Screen>
  );
}
