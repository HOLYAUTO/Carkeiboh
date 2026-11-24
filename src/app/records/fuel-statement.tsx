import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FUEL_TYPE_LABELS, type FuelPriceBasis } from '@domain/fuel.ts';
import { matchesExistingFill, rowTotalYen, type Statement, type StatementRow } from '@shared/fuel-statement.ts';
import { AppText, Badge, Button, Card, Divider, Notice, Num, QueryFallback, Screen } from '../../components/ui';
import { fuelFills, PAID_NOW, saveExpense, useInvalidate, useVehicleBundle, type VehicleBundle } from '../../lib/data';
import { fullDate, yen } from '../../lib/format';
import { pickPhotos } from '../../lib/photo';
import { invokeFunction } from '../../lib/supabase';
import { spacing, useColors } from '../../theme';
import { alertError } from '../../lib/alerts';
import { describeError } from '../../lib/error-codes';

/** 明細の写真は字が細かいので大きめにして送る */
const PHOTO_MAX_SIDE = 2000;

interface Line extends StatementRow {
  key: string;
  basis: FuelPriceBasis;
  totalYen: number | null;
  duplicate: boolean;
  selected: boolean;
}

/**
 * 掛けカードの月の明細から、給油をまとめて登録する。明細の写真（何ページでも）を読み取り、
 * 一覧で確かめてから登録する。登録済みの給油と重なる行は、最初から外しておく
 */
export default function FuelStatementScreen() {
  const { bundle } = useVehicleBundle();
  if (!bundle.isSuccess) return <QueryFallback queries={[bundle]} />;
  return <FuelStatement bundle={bundle.data} />;
}

function FuelStatement({ bundle }: { bundle: VehicleBundle }) {
  const colors = useColors();
  const invalidate = useInvalidate();
  const [lines, setLines] = useState<Line[]>([]);
  const [statementTotal, setStatementTotal] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const lastFuelType = bundle.expenses.find((e) => e.category === 'fuel' && e.fuel_type)?.fuel_type ?? 'regular';

  const read = async (source: 'camera' | 'library') => {
    const photos = await pickPhotos(source, { maxSide: PHOTO_MAX_SIDE, multiple: true, limit: 6 });
    if (photos.length === 0) return;
    setReading(true);
    try {
      const existing = fuelFills(bundle.expenses).map((f) => ({ date: f.date, liters: f.liters, amountYen: f.amountYen }));
      const added: Line[] = [];
      let total: number | null = statementTotal;
      for (const photo of photos) {
        const s = await invokeFunction<Statement>('read-fuel-statement', { image: photo.base64 });
        if (s.totalYen != null) total = (total ?? 0) + s.totalYen;
        for (const row of s.rows) {
          const totalYen = rowTotalYen(row, s.basis);
          const already = [...lines, ...added].some((l) => l.date === row.date && l.liters === row.liters && l.amountYen === row.amountYen);
          if (already) continue;
          const duplicate = matchesExistingFill(row, totalYen, existing);
          added.push({ ...row, key: `${row.date}-${lines.length + added.length}`, basis: s.basis, totalYen, duplicate, selected: !duplicate && totalYen != null });
        }
      }
      setLines((prev) => [...prev, ...added].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
      setStatementTotal(total);
      const dup = added.filter((l) => l.duplicate).length;
      setNotice(
        added.length > 0
          ? `${added.length}件の給油を読み取りました。${dup > 0 ? `登録済みと思われる${dup}件は外しています。` : ''}明細と見比べてから登録してください。`
          : '給油の行を読み取れませんでした。明るい場所で、明細の全体が写るように撮り直してください。',
      );
    } catch (e) {
      alertError('読み取れませんでした', e);
    } finally {
      setReading(false);
    }
  };

  const choose = () =>
    Alert.alert('掛けカードの明細を読み取る', '明細の給油の行が写るように撮ってください。何ページあっても大丈夫です。写真は読み取りだけに使い、保存しません。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: 'アルバムから選ぶ', onPress: () => read('library') },
      { text: '撮影する', onPress: () => read('camera') },
    ]);

  const toggle = (key: string) => setLines((prev) => prev.map((l) => (l.key === key && l.totalYen != null ? { ...l, selected: !l.selected } : l)));
  const selected = lines.filter((l) => l.selected && l.totalYen != null);
  const selectedTotal = selected.reduce((s, l) => s + l.totalYen!, 0);
  const allTotal = lines.reduce((s, l) => s + (l.totalYen ?? 0), 0);

  const save = async () => {
    setBusy(true);
    let saved = 0;
    try {
      for (const l of selected) {
        await saveExpense({
          vehicleId: bundle.vehicle.id,
          category: 'fuel',
          date: l.date,
          amountYen: l.totalYen!,
          odoKm: null,
          note: l.station,
          fuel: {
            liters: l.liters,
            unitPrice: l.unitPrice,
            priceBasis: l.unitPrice != null ? l.basis : null,
            fuelType: l.fuelType ?? lastFuelType,
            // 明細からは満タンか分からないので、燃費の計算には使わない
            fullTank: false,
          },
          payment: { ...PAID_NOW, onAccount: true },
        });
        saved += 1;
      }
      await invalidate();
      Alert.alert('登録しました', `${saved}件の給油を登録しました。`, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      await invalidate();
      Alert.alert('途中で保存できませんでした', `${saved}件は登録しました。${describeError(e)}`);
      setLines((prev) => prev.filter((l) => !selected.slice(0, saved).some((s) => s.key === l.key)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <AppText>掛けカードの月の明細から、給油をまとめて登録します。</AppText>
      <Button title={lines.length > 0 ? '明細をもう1枚読み取る' : '明細を読み取る'} variant={lines.length > 0 ? 'secondary' : 'primary'} loading={reading} onPress={choose} />
      {notice && <Notice title="読み取った内容を確認してください">{notice}</Notice>}
      {lines.length > 0 && (
        <Card>
          {lines.map((l, i) => (
            <View key={l.key}>
              {i > 0 && <Divider />}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: l.selected, disabled: l.totalYen == null }}
                onPress={() => toggle(l.key)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}
              >
                <Ionicons name={l.selected ? 'checkbox' : 'square-outline'} size={22} color={l.selected ? colors.accent : colors.textSecondary} />
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText>{`${fullDate(l.date)}${l.station ? `　${l.station}` : ''}`}</AppText>
                  <AppText variant="caption">
                    {[
                      l.fuelType ? FUEL_TYPE_LABELS[l.fuelType] : null,
                      l.liters != null && l.unitPrice != null ? `${l.liters}L × ${l.unitPrice}円/L（${l.basis === 'tax_excluded' ? '税抜' : '税込'}）` : l.liters != null ? `${l.liters}L` : null,
                    ]
                      .filter(Boolean)
                      .join('・')}
                  </AppText>
                  {l.duplicate && <Badge label="登録済みと思われます" tone="neutral" />}
                </View>
                <Num>{l.totalYen != null ? yen(l.totalYen) : '—'}</Num>
              </Pressable>
            </View>
          ))}
          <Divider />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText>{`登録する ${selected.length}件（税込）`}</AppText>
            <Num size={18}>{yen(selectedTotal)}</Num>
          </View>
          {statementTotal != null && Math.abs(statementTotal - allTotal) > lines.length && (
            <AppText variant="caption">{`明細の合計（${yen(statementTotal)}）と、読み取った行の合計（${yen(allTotal)}）が違います。読み落とした行がないか確かめてください。`}</AppText>
          )}
        </Card>
      )}
      {lines.length > 0 && <Button title={`${selected.length}件を登録する`} disabled={selected.length === 0} loading={busy} onPress={save} />}
      <AppText variant="caption">
        掛けカードの給油として記録します（支払い：かけ）。明細からは走行距離と満タンかどうかが分からないため、燃費の計算には使いません。燃費も出したいときは、給油ごとに記録してください。
      </AppText>
    </Screen>
  );
}
