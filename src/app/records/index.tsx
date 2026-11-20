import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { EXPENSE_CATEGORY_LABELS } from '@domain/costs.ts';
import { AppText, Badge, Card, ListCard, Num, QueryFallback, Screen } from '../../components/ui';
import { wearTitle } from '../../components/RecordForm';
import { useVehicleBundle, vehicleUnit } from '../../lib/data';
import { fullDate, km, yen } from '../../lib/format';
import { spacing, useColors } from '../../theme';

interface Item {
  id: string;
  date: string;
  title: string;
  detail: string;
  amount: number | null;
  verified: boolean;
  sortKey: string;
}

/** 記録の一覧。Ledra から来た記録は「証明付き」と表示し、本体は編集できない（金額だけ追記できる） */
export default function Records() {
  const colors = useColors();
  const { bundle } = useVehicleBundle();
  const items = useMemo<Item[]>(() => {
    if (!bundle.data) return [];
    const { oilChanges, expenses, wearChecks, readings, vehicle } = bundle.data;
    const unit = vehicleUnit(vehicle);
    const dist = (n: number) => km(n, unit);
    /** 給油は「32.15L・¥172/L・満タン」も添える */
    const fuelDetail = (e: (typeof expenses)[number]) =>
      e.category !== 'fuel'
        ? []
        : [
            e.fuel_liters != null ? `${Number(e.fuel_liters)}L` : null,
            e.fuel_unit_price != null ? `¥${Number(e.fuel_unit_price)}/L${e.fuel_price_basis === 'tax_excluded' ? '（税抜）' : ''}` : null,
            e.fuel_full_tank ? '満タン' : null,
          ];
    const oilAmounts = new Map(expenses.filter((e) => e.oil_change_id).map((e) => [e.oil_change_id!, e.amount_yen]));
    const list: Item[] = [
      ...oilChanges.map((o) => ({
        id: `oil:${o.id}`,
        date: o.performed_on,
        title: o.oil_changed && o.filter_changed ? 'オイル・フィルター交換' : o.oil_changed ? 'オイル交換' : 'オイルフィルター交換',
        detail: [dist(o.odo_km), o.shop_name].filter(Boolean).join('・'),
        amount: oilAmounts.get(o.id) ?? null,
        verified: o.source === 'ledra',
        sortKey: o.created_at,
      })),
      ...wearChecks.map((w) => ({
        id: `wear:${w.id}`,
        date: w.performed_on,
        title: wearTitle(w),
        detail: [w.remaining_mm != null ? `残り ${Number(w.remaining_mm)}mm` : null, w.odo_km != null ? dist(w.odo_km) : null, w.shop_name]
          .filter(Boolean)
          .join('・'),
        amount: null,
        verified: w.source === 'ledra',
        sortKey: w.created_at,
      })),
      ...expenses
        .filter((e) => !e.oil_change_id)
        .map((e) => ({
          id: `expense:${e.id}`,
          date: e.spent_on,
          title: EXPENSE_CATEGORY_LABELS[e.category],
          detail: [...fuelDetail(e), e.odo_km != null ? dist(e.odo_km) : null, e.note].filter(Boolean).join('・'),
          amount: e.amount_yen,
          verified: e.source === 'ledra',
          sortKey: e.created_at,
        })),
      ...readings.map((r) => ({
        id: `odometer:${r.id}`,
        date: r.read_on,
        title: r.source === 'onboarding' ? '走行距離（初回設定）' : '走行距離',
        detail: dist(r.odo_km),
        amount: null,
        verified: false,
        sortKey: r.created_at,
      })),
    ];
    return list.sort((a, b) => (a.date === b.date ? b.sortKey.localeCompare(a.sortKey) : b.date.localeCompare(a.date)));
  }, [bundle.data]);

  if (!bundle.isSuccess) return <QueryFallback queries={[bundle]} />;

  return (
    <Screen>
      {items.length === 0 ? (
        <Card>
          <AppText variant="caption">まだ記録がありません。「記録する」から登録できます。</AppText>
        </Card>
      ) : (
        <ListCard>
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${fullDate(item.date)} ${item.title}${item.verified ? ' 証明付き' : ''}`}
              onPress={() => router.push({ pathname: '/records/[id]', params: { id: item.id } })}
              style={({ pressed }) => ({ minHeight: 56, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md, opacity: pressed ? 0.6 : 1 })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: spacing.xs }}>
                  <AppText style={{ flexShrink: 1 }}>{item.title}</AppText>
                  {item.verified && <Badge label="証明付き" />}
                </View>
                <AppText variant="caption">
                  {fullDate(item.date)}
                  {item.detail ? `・${item.detail}` : ''}
                </AppText>
              </View>
              {item.amount != null && <Num style={{ color: colors.text }}>{yen(item.amount)}</Num>}
            </Pressable>
          ))}
        </ListCard>
      )}
    </Screen>
  );
}
