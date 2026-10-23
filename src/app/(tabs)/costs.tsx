import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { EXPENSE_CATEGORY_LABELS, summarizeCosts, type CostPeriod } from '@domain/costs.ts';
import { monthKey } from '@domain/dates.ts';
import { MonthlyBarChart } from '../../components/BarChart';
import { AppText, Card, Divider, ErrorView, Loading, Num, Screen, Segmented } from '../../components/ui';
import { useVehicleBundle } from '../../lib/data';
import { fullDate, km, yen } from '../../lib/format';
import { colors, spacing } from '../../theme';

const PERIODS: { value: CostPeriod; label: string }[] = [
  { value: 'month', label: '今月' },
  { value: 'year', label: '今年' },
  { value: 'all', label: 'すべて' },
];

export default function Costs() {
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

  if (bundle.isPending) return <Loading />;
  if (bundle.isError || !summary) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;

  return (
    <Screen>
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
            <AppText variant="label">1kmあたり</AppText>
            <Num size={18}>{summary.perKmYen != null ? `¥${summary.perKmYen.toLocaleString('ja-JP')}` : '—'}</Num>
            <AppText variant="caption">
              {summary.distanceKm != null ? `期間の走行 ${km(summary.distanceKm)}` : '走行距離の記録が足りません'}
            </AppText>
          </View>
        </View>
      </Card>

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
    </Screen>
  );
}
