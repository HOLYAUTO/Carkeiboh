import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { EXPENSE_CATEGORY_LABELS, summarizeCosts, type CostPeriod } from '@domain/costs.ts';
import { monthKey } from '@domain/dates.ts';
import { formatKmPerLiter, summarizeFuel } from '@domain/fuel.ts';
import { distanceUnitLabel, KM_PER_MILE } from '@domain/units.ts';
import { MonthlyBarChart } from '../../components/BarChart';
import { SponsorSlot } from '../../components/SponsorSlot';
import { AppText, Button, Card, Divider, ErrorView, IconButton, Num, Screen, ScreenHeader, Segmented, Skeleton } from '../../components/ui';
import { fuelFills, useVehicleBundle, vehicleUnit } from '../../lib/data';
import { fullDate, km, yen } from '../../lib/format';
import { spacing, useColors } from '../../theme';

const PERIODS: { value: CostPeriod; label: string }[] = [
  { value: 'month', label: '今月' },
  { value: 'year', label: '今年' },
  { value: 'all', label: 'すべて' },
];

export default function Costs() {
  const colors = useColors();
  const { bundle } = useVehicleBundle();
  const [period, setPeriod] = useState<CostPeriod>('month');
  const summary = useMemo(() => {
    if (!bundle.data) return null;
    const { expenses, state, today } = bundle.data;
    return summarizeCosts(
      expenses.map((e) => ({ date: e.spent_on, amountYen: e.amount_yen, category: e.category })),
      state.readings,
      period,
      today,
    );
  }, [bundle.data, period]);
  const fuel = useMemo(() => {
    if (!bundle.data || !summary) return null;
    const fills = fuelFills(bundle.data.expenses);
    if (fills.length === 0) return null;
    const replacements = bundle.data.meterReplacements.map((m) => ({ replacedOn: m.replaced_on, odoBeforeKm: m.odo_before_km, odoAfterKm: m.odo_after_km }));
    return summarizeFuel(fills, summary.from, summary.to, replacements);
  }, [bundle.data, summary]);

  const header = <ScreenHeader tag="COST" title="維持費" right={<IconButton icon="settings-outline" label="設定" onPress={() => router.push('/settings')} />} />;
  if (bundle.isPending) {
    return (
      <Screen header={header}>
        <Skeleton height={200} />
        <Skeleton height={160} />
      </Screen>
    );
  }
  if (bundle.isError || !summary) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;
  const unit = vehicleUnit(bundle.data.vehicle);
  // 1kmあたりの維持費を、mile の車両は1mileあたりに直す
  const perUnitYen = summary.perKmYen != null ? Math.round(summary.perKmYen * (unit === 'mile' ? KM_PER_MILE : 1) * 10) / 10 : null;

  return (
    <Screen header={header}>
      <Segmented options={PERIODS} value={period} onChange={setPeriod} />
      <Card>
        <AppText variant="label">登録済みの合計</AppText>
        <Num size={36}>{yen(summary.totalYen)}</Num>
        <AppText variant="caption">
          {fullDate(summary.from)} 〜 {fullDate(summary.to)}。記録した支出だけの合計です（記録漏れがあると実際より少なくなります）。
        </AppText>
        <Divider />
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="label">月平均</AppText>
            <Num size={18}>{yen(summary.monthlyAverageYen)}</Num>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="label">{`1${distanceUnitLabel(unit)}あたり`}</AppText>
            <Num size={18}>{perUnitYen != null ? `¥${perUnitYen.toLocaleString('ja-JP')}` : '—'}</Num>
            <AppText variant="caption">
              {summary.distanceKm != null ? `期間の走行 ${km(summary.distanceKm, unit)}` : '走行距離の記録が足りません'}
            </AppText>
          </View>
        </View>
      </Card>

      {fuel && (
        <Card>
          <AppText variant="heading">給油・燃費</AppText>
          <AppText variant="label">平均燃費</AppText>
          <Num size={28}>{fuel.averageKmPerLiter != null ? formatKmPerLiter(fuel.averageKmPerLiter) : '—'}</Num>
          <AppText variant="caption">
            {fuel.averageKmPerLiter != null
              ? `この期間に満タンにした給油から計算（満タン法：走った距離 ${km(fuel.distanceKm, unit)} ÷ 給油量）。`
              : '満タンの給油を、走行距離と給油量つきで2回以上記録すると計算します。'}
          </AppText>
          <Divider />
          <View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="label">前回の燃費</AppText>
              <Num size={16}>{fuel.latest ? formatKmPerLiter(fuel.latest.kmPerLiter) : '—'}</Num>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="label">給油量</AppText>
              <Num size={16}>{`${fuel.liters.toLocaleString('ja-JP')}L`}</Num>
              <AppText variant="caption">{`${fuel.count}回・${yen(fuel.amountYen)}`}</AppText>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="label">平均単価</AppText>
              <Num size={16}>{fuel.averageUnitPriceYen != null ? `¥${fuel.averageUnitPriceYen.toLocaleString('ja-JP')}/L` : '—'}</Num>
            </View>
          </View>
        </Card>
      )}

      <Card>
        <AppText variant="heading">月ごとの推移</AppText>
        <MonthlyBarChart data={summary.byMonth} currentMonth={monthKey(summary.to)} />
      </Card>

      <Card>
        <AppText variant="heading">項目別の内訳</AppText>
        {summary.byCategory.length === 0 ? (
          <AppText variant="caption">この期間の支出はまだありません。「記録する」から登録できます。</AppText>
        ) : (
          summary.byCategory.map((c) => (
            <View key={c.category} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <AppText>{EXPENSE_CATEGORY_LABELS[c.category]}</AppText>
                <AppText>
                  <Num>{yen(c.totalYen)}</Num>
                  <AppText variant="caption">{`  ${Math.round(c.ratio * 100)}%`}</AppText>
                </AppText>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.track }}>
                <View style={{ width: `${Math.round(c.ratio * 100)}%`, height: 6, borderRadius: 3, backgroundColor: colors.accent }} />
              </View>
            </View>
          ))
        )}
      </Card>
      <AppText variant="caption" style={{ marginHorizontal: spacing.xs }}>
        オイル交換の金額は、オイル交換の記録に入力した分だけを数えます（整備・修理と二重に数えません）。
      </AppText>

      <Button title="確定申告用のまとめ" variant="secondary" onPress={() => router.push('/settings/tax-report')} />

      <SponsorSlot placement="costs" />
    </Screen>
  );
}
