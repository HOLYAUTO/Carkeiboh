import { Link, router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { summarizeCosts } from '@domain/costs.ts';
import { SERVICE_REMAINING_KM_ALERT, type UpcomingItem } from '@domain/reminders.ts';
import type { ServiceForecast } from '@domain/service.ts';
import { AppText, Badge, Button, Card, Divider, ErrorView, Loading, Notice, Num, ProgressBar } from '../../components/ui';
import { useVehicleBundle } from '../../lib/data';
import { daysLeft, fullDate, km, monthDay, yen } from '../../lib/format';
import { colors, spacing } from '../../theme';

export default function Home() {
  const { bundle } = useVehicleBundle();
  if (bundle.isPending) return <Loading />;
  if (bundle.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;
  return <HomeContent data={bundle.data} refreshing={bundle.isRefetching} onRefresh={() => bundle.refetch()} />;
}

function HomeContent({
  data,
  refreshing,
  onRefresh,
}: {
  data: NonNullable<ReturnType<typeof useVehicleBundle>['bundle']['data']>;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { vehicle, state, today, expenses } = data;
  const costs = useMemo(() => {
    const items = expenses.map((e) => ({ date: e.spent_on, amountYen: e.amount_yen, category: e.category }));
    return {
      month: summarizeCosts(items, state.readings, 'month', today).totalYen,
      year: summarizeCosts(items, state.readings, 'year', today).totalYen,
    };
  }, [expenses, state.readings, today]);
  const overdueShaken = state.upcoming.find((u) => u.kind === 'shaken' && u.level === 'overdue');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={{ gap: 2 }}>
        <AppText variant="title">{vehicle.name}</AppText>
        {vehicle.plate_number && <AppText variant="caption">{vehicle.plate_number}</AppText>}
      </View>

      {overdueShaken && (
        <Pressable accessibilityRole="button" onPress={() => router.push('/settings/deadlines')}>
          <Notice title={`車検の満了日を${-overdueShaken.remainingDays}日過ぎています`}>
            車検を受けたら、新しい満了日を登録してください。登録するまでこの表示は消えません。
          </Notice>
        </Pressable>
      )}

      <OilCard forecast={state.oil?.forecast ?? null} />
      {state.filter && <FilterCard forecast={state.filter.forecast} />}

      <Link href="/costs" asChild>
        <Pressable accessibilityRole="button">
          <Card style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="label">今月の維持費</AppText>
              <Num size={22}>{yen(costs.month)}</Num>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="label">今年の維持費</AppText>
              <Num size={22}>{yen(costs.year)}</Num>
            </View>
          </Card>
        </Pressable>
      </Link>
      <AppText variant="caption" style={{ marginTop: -spacing.sm, marginLeft: spacing.xs }}>登録済みの合計です</AppText>

      <Card>
        <AppText variant="heading">もうすぐの期限</AppText>
        {state.upcoming.length === 0 ? (
          <AppText variant="caption">90日以内の期限はありません。車検・保険の日付は設定から登録できます。</AppText>
        ) : (
          state.upcoming.map((item, i) => (
            <View key={`${item.kind}-${item.dueOn}`}>
              {i > 0 && <Divider />}
              <UpcomingRow item={item} />
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

function OilCard({ forecast }: { forecast: ServiceForecast | null }) {
  if (!forecast) {
    return (
      <Card>
        <AppText variant="heading">次回のオイル交換</AppText>
        <AppText style={{ color: colors.textSecondary }}>
          前回のオイル交換を記録すると、次の交換まであと何kmか表示します。
        </AppText>
        <Button title="オイル交換を記録する" onPress={() => router.push({ pathname: '/record', params: { category: 'oil_change' } })} />
      </Card>
    );
  }
  const remaining = forecast.remainingKm;
  const near = (remaining != null && remaining <= SERVICE_REMAINING_KM_ALERT) || (forecast.remainingDays ?? 99) <= 14;
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="label">次回のオイル交換まで</AppText>
        <Badge label="推定" tone="neutral" />
      </View>
      {remaining != null ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <AppText variant="heading">{remaining > 0 ? 'あと' : ''}</AppText>
          <Num size={44} style={{ color: near ? colors.caution : colors.text }} accessibilityLabel={remaining > 0 ? `推定であと${remaining}キロ` : `推定で${-remaining}キロ超過`}>
            {Math.abs(remaining).toLocaleString('ja-JP')}
          </Num>
          <AppText variant="heading">{remaining > 0 ? 'km' : 'km 超過'}</AppText>
        </View>
      ) : (
        <Num size={32}>{forecast.remainingDays != null ? daysLeft(forecast.remainingDays) : '—'}</Num>
      )}
      <ProgressBar value={forecast.progress} tone={near ? 'caution' : 'accent'} label="前回の交換からの進み具合" />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View>
          <AppText variant="caption">前回 {monthDay(forecast.baseline.date)}</AppText>
          <Num size={13}>{km(forecast.baseline.odoKm)}</Num>
        </View>
        {forecast.dueOdoKm != null && (
          <View style={{ alignItems: 'flex-end' }}>
            <AppText variant="caption">予定距離</AppText>
            <Num size={13}>{km(forecast.dueOdoKm)}</Num>
          </View>
        )}
      </View>
      <Divider />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="label">目安日</AppText>
        <AppText>
          <Num>{forecast.dueDate ? fullDate(forecast.dueDate) : '—'}</Num>
          {forecast.remainingDays != null && `（${daysLeft(forecast.remainingDays)}）`}
        </AppText>
      </View>
      <AppText variant="caption">
        {forecast.dateByDistance && `予定距離に届く予測日 ${monthDay(forecast.dateByDistance)}`}
        {forecast.dateByDistance && forecast.dateByTime && ' ／ '}
        {forecast.dateByTime && `期間の目安 ${monthDay(forecast.dateByTime)}`}
        {'\n'}早い方を目安日にしています。
        {forecast.paceBasis === 'actual'
          ? `走行ペースは記録から推定（1日約${Math.round(forecast.kmPerDay)}km）。`
          : '走行距離の記録が2件以上たまるまで、年間走行距離の目安で推定しています。'}
      </AppText>
    </Card>
  );
}

function FilterCard({ forecast }: { forecast: ServiceForecast }) {
  const remaining = forecast.remainingKm;
  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="label">オイルフィルター交換まで</AppText>
        <Badge label="推定" tone="neutral" />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Num size={20}>{remaining != null ? (remaining > 0 ? `あと ${km(remaining)}` : `${km(-remaining)} 超過`) : '—'}</Num>
        <AppText variant="caption">
          {forecast.dueDate ? `目安日 ${monthDay(forecast.dueDate)}（${daysLeft(forecast.remainingDays!)}）` : ''}
        </AppText>
      </View>
      <ProgressBar value={forecast.progress} label="フィルター交換からの進み具合" />
    </Card>
  );
}

function UpcomingRow({ item }: { item: UpcomingItem }) {
  const tone = item.level === 'normal' ? colors.text : colors.caution;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.sm }}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText>{item.label}</AppText>
        <AppText variant="caption">
          {fullDate(item.dueOn)}
          {item.estimated ? '（推定）' : ''}
        </AppText>
      </View>
      <AppText style={{ color: tone, fontVariant: ['tabular-nums'] }}>
        {item.level === 'overdue' ? `期限切れ・${daysLeft(item.remainingDays)}` : daysLeft(item.remainingDays)}
      </AppText>
    </View>
  );
}
