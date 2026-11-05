import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { summarizeCosts } from '@domain/costs.ts';
import { SERVICE_REMAINING_KM_ALERT, type UpcomingItem } from '@domain/reminders.ts';
import type { ServiceForecast } from '@domain/service.ts';
import { distanceUnitLabel, fromKm, type DistanceUnit } from '@domain/units.ts';
import {
  AppText,
  Badge,
  Card,
  Divider,
  ErrorView,
  IconButton,
  ListRow,
  NextActionCard,
  Num,
  ProgressRing,
  Screen,
  ScreenHeader,
  SectionTitle,
  Skeleton,
  Tachometer,
} from '../../components/ui';
import { HomeNotices } from '../../components/HomeNotices';
import { SponsorSlot } from '../../components/SponsorSlot';
import { VehiclePhoto } from '../../components/VehiclePhoto';
import { useVehicleBundle, vehicleUnit, type VehicleBundle } from '../../lib/data';
import { daysLeft, fullDate, km, longDate, monthDay, weekday, yen } from '../../lib/format';
import { cardShadow, fonts, radius, spacing, themedStyles, useColors } from '../../theme';

const settingsButton = <IconButton icon="settings-outline" label="設定" onPress={() => router.push('/settings')} />;

export default function Home() {
  const { bundle } = useVehicleBundle();
  if (bundle.isPending) {
    return (
      <Screen header={<ScreenHeader tag="GARAGE LOG" title="" right={settingsButton} />}>
        <Skeleton height={220} />
        <Skeleton height={88} />
        <Skeleton height={160} />
      </Screen>
    );
  }
  if (bundle.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;
  return <HomeContent data={bundle.data} refreshing={bundle.isRefetching} onRefresh={() => bundle.refetch()} />;
}

function nearDue(f: ServiceForecast): boolean {
  return (f.remainingKm != null && f.remainingKm <= SERVICE_REMAINING_KM_ALERT) || (f.remainingDays != null && f.remainingDays <= 14);
}

/** いま一番やるべきことを1つだけ選ぶ（車検切れ → オイル未記録 → オイル交換が近い の順） */
function NextAction({ data }: { data: VehicleBundle }) {
  const unit = vehicleUnit(data.vehicle);
  const { state } = data;
  const overdueShaken = state.upcoming.find((u) => u.kind === 'shaken' && u.level === 'overdue');
  if (overdueShaken) {
    return (
      <NextActionCard
        tone="caution"
        title="車検の更新を登録する"
        reason={`車検の満了日（${fullDate(overdueShaken.dueOn)}）を${-overdueShaken.remainingDays}日過ぎています。更新を登録するまでこの表示は消えません。`}
        cta="満了日を登録する"
        onPress={() => router.push('/settings/deadlines')}
      />
    );
  }
  const oil = state.oil?.forecast;
  if (!oil) {
    return (
      <NextActionCard
        title="前回のオイル交換を記録する"
        reason="記録すると、次の交換まであと何kmかを表示します。"
        cta="オイル交換を記録する"
        onPress={() => router.push({ pathname: '/records/new', params: { kind: 'oil_change' } })}
      />
    );
  }
  if (nearDue(oil)) {
    const overdue = (oil.remainingKm != null && oil.remainingKm <= 0) || (oil.remainingDays != null && oil.remainingDays < 0);
    const parts = [
      oil.remainingKm != null && (oil.remainingKm > 0 ? `推定であと${km(oil.remainingKm, unit)}` : `推定で${km(-oil.remainingKm, unit)}超過`),
      oil.remainingDays != null &&
        (oil.remainingDays >= 0 ? `目安日まで${daysLeft(oil.remainingDays)}` : `目安日を${-oil.remainingDays}日過ぎています`),
    ].filter(Boolean);
    return (
      <NextActionCard
        tone={overdue ? 'caution' : 'accent'}
        title={overdue ? 'オイル交換の目安を過ぎています' : 'オイル交換の時期です'}
        reason={`${parts.join('・')}。交換したら記録すると、次の目安を出し直します。`}
        cta="オイル交換を記録する"
        onPress={() => router.push({ pathname: '/records/new', params: { kind: 'oil_change' } })}
      />
    );
  }
  return null;
}

function HomeContent({ data, refreshing, onRefresh }: { data: VehicleBundle; refreshing: boolean; onRefresh: () => void }) {
  const colors = useColors();
  const { vehicle, state, today, expenses } = data;
  const costs = useMemo(() => {
    const items = expenses.map((e) => ({ date: e.spent_on, amountYen: e.amount_yen, category: e.category }));
    return {
      month: summarizeCosts(items, state.readings, 'month', today).totalYen,
      year: summarizeCosts(items, state.readings, 'year', today).totalYen,
    };
  }, [expenses, state.readings, today]);

  return (
    <Screen
      header={
        <ScreenHeader
          tag="GARAGE LOG"
          overline={longDate(today)}
          title={vehicle.name}
          plate={vehicle.plate_number ?? undefined}
          right={settingsButton}
          onTitlePress={() => router.push('/vehicles')}
          titlePressLabel={`${vehicle.name}。クルマを切り替える・追加する`}
        />
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />}
    >
      <HomeNotices />
      <VehiclePhoto vehicle={vehicle} />
      <NextAction data={data} />
      {/* オイル交換・車検が近いときだけ、近くの整備工場への導線を出す */}
      {((state.oil && nearDue(state.oil.forecast)) || state.upcoming.some((u) => u.kind === 'shaken' || u.kind === 'inspection')) && (
        <Card style={{ paddingVertical: 4 }}>
          <ListRow title="近くの整備工場を探す" detail="ルート検索や電話での予約ができます" onPress={() => router.push('/shops')} />
        </Card>
      )}
      {state.oil && <OilCard forecast={state.oil.forecast} unit={vehicleUnit(data.vehicle)} />}
      {state.filter && <FilterRow forecast={state.filter.forecast} unit={vehicleUnit(data.vehicle)} />}

      <Pressable accessibilityRole="button" accessibilityLabel="維持費を見る" onPress={() => router.push('/costs')}>
        <Card style={{ flexDirection: 'row', gap: spacing.lg }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="label">今月の維持費</AppText>
            <Num size={22}>{yen(costs.month)}</Num>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="label">今年の維持費</AppText>
            <Num size={22}>{yen(costs.year)}</Num>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} style={{ alignSelf: 'center' }} />
        </Card>
      </Pressable>
      <AppText variant="caption" style={{ marginTop: -spacing.sm, marginLeft: spacing.xs }}>登録済みの合計です</AppText>

      <SectionTitle action={{ label: '期限を登録', onPress: () => router.push('/settings/deadlines') }}>もうすぐの期限</SectionTitle>
      {state.upcoming.length === 0 ? (
        <Card>
          <AppText variant="caption">90日以内の期限はありません。車検・保険の日付は「期限を登録」から登録できます。</AppText>
        </Card>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {state.upcoming.map((item) => (
            <UpcomingRow key={`${item.kind}-${item.dueOn}`} item={item} />
          ))}
        </View>
      )}

      <SponsorSlot placement="home" />
    </Screen>
  );
}

function OilCard({ forecast, unit }: { forecast: ServiceForecast; unit: DistanceUnit }) {
  const colors = useColors();
  const styles = useStyles();
  const remaining = forecast.remainingKm;
  const near = nearDue(forecast);
  return (
    <Card>
      <View style={styles.titleRow}>
        <AppText variant="label" style={{ flexShrink: 1 }}>次回のオイル交換まで</AppText>
        <Badge label="推定" tone="neutral" />
      </View>
      <Tachometer value={forecast.progress} label="前回の交換から交換時期までの進み具合">
        {remaining != null ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, maxWidth: '100%' }}>
              <Num
                size={48}
                style={{ color: near ? colors.caution : colors.text, lineHeight: 56 }}
                accessibilityLabel={
                  remaining > 0
                    ? `推定であと${fromKm(remaining, unit)}${unit === 'mile' ? 'マイル' : 'キロ'}`
                    : `推定で${fromKm(-remaining, unit)}${unit === 'mile' ? 'マイル' : 'キロ'}超過`
                }
              >
                {fromKm(Math.abs(remaining), unit).toLocaleString('ja-JP')}
              </Num>
              <Num size={18} style={{ color: colors.textSecondary, flexShrink: 0 }}>{distanceUnitLabel(unit)}</Num>
            </View>
            <AppText variant="caption" style={near ? { color: colors.caution } : undefined}>
              {remaining > 0 ? '次の交換まで' : '目安を超過'}
            </AppText>
          </>
        ) : (
          <Num size={32}>{forecast.remainingDays != null ? daysLeft(forecast.remainingDays) : '—'}</Num>
        )}
      </Tachometer>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Stat label={`前回 ${monthDay(forecast.baseline.date)}`} value={km(forecast.baseline.odoKm, unit)} />
        <Stat label="予定距離" value={forecast.dueOdoKm != null ? km(forecast.dueOdoKm, unit) : '—'} />
        <Stat
          label="目安日"
          value={forecast.dueDate ? monthDay(forecast.dueDate) : '—'}
          sub={forecast.remainingDays != null ? daysLeft(forecast.remainingDays) : undefined}
          caution={near}
        />
      </View>

      <Divider />
      <AppText variant="caption">
        {forecast.dateByDistance && `予定距離に届く予測日 ${monthDay(forecast.dateByDistance)}`}
        {forecast.dateByDistance && forecast.dateByTime && ' ／ '}
        {forecast.dateByTime && `期間の目安 ${monthDay(forecast.dateByTime)}`}
        {'\n'}早い方を目安日にしています。
        {forecast.paceBasis === 'actual'
          ? `走行ペースは記録から推定（1日約${km(forecast.kmPerDay, unit)}）。`
          : '走行距離の記録が2件以上たまるまで、年間走行距離の目安で推定しています。'}
      </AppText>
    </Card>
  );
}

/** 小さな数値のかたまり（ラベル＋値）。3つ並べて使う */
function Stat({ label, value, sub, caution }: { label: string; value: string; sub?: string; caution?: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={[styles.stat, caution && { backgroundColor: colors.cautionBackground }]}>
      <Text style={[styles.statLabel, caution && { color: colors.caution }]}>{label}</Text>
      <Num size={14} style={caution ? { color: colors.caution } : undefined}>{value}</Num>
      {sub && <Text style={[styles.statSub, caution && { color: colors.caution }]}>{sub}</Text>}
    </View>
  );
}

function FilterRow({ forecast, unit }: { forecast: ServiceForecast; unit: DistanceUnit }) {
  const colors = useColors();
  const styles = useStyles();
  const remaining = forecast.remainingKm;
  const near = nearDue(forecast);
  return (
    <View style={styles.row}>
      <ProgressRing value={forecast.progress} size={44} strokeWidth={4} tone={near ? 'caution' : 'accent'} label="フィルター交換からの進み具合" />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.titleRow}>
          <AppText variant="label" style={{ flexShrink: 1 }}>フィルター交換まで</AppText>
          <Badge label="推定" tone="neutral" />
        </View>
        <Num size={16} style={near ? { color: colors.caution } : undefined}>
          {remaining != null ? (remaining > 0 ? `あと ${km(remaining, unit)}` : `${km(-remaining, unit)} 超過`) : '—'}
        </Num>
      </View>
      {forecast.dueDate && forecast.remainingDays != null && (
        <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
          <AppText variant="caption">目安日 {monthDay(forecast.dueDate)}</AppText>
          <AppText variant="caption" style={near ? { color: colors.caution } : undefined}>{daysLeft(forecast.remainingDays)}</AppText>
        </View>
      )}
    </View>
  );
}

const LEVEL_BADGE = {
  overdue: { label: '期限切れ', tone: 'caution' },
  soon: { label: 'もうすぐ', tone: 'caution' },
  normal: { label: '予定', tone: 'neutral' },
} as const;

/** 推定の目安（オイル・フィルター）は「期限切れ」ではなく「目安超過」と書く */
function levelBadge(item: UpcomingItem) {
  if (item.level === 'overdue' && item.estimated) return { label: '目安超過', tone: 'caution' as const };
  return LEVEL_BADGE[item.level];
}

function UpcomingRow({ item }: { item: UpcomingItem }) {
  const colors = useColors();
  const styles = useStyles();
  const badge = levelBadge(item);
  const caution = item.level !== 'normal';
  const onPress = () =>
    item.kind === 'oil' || item.kind === 'filter'
      ? router.push({ pathname: '/records/new', params: { kind: 'oil_change' } })
      : router.push('/settings/deadlines');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.label} ${fullDate(item.dueOn)} ${daysLeft(item.remainingDays)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, caution && { backgroundColor: colors.cautionBackground }, pressed && { opacity: 0.7 }]}
    >
      {/* 予定表のように、日付を左に大きく置く */}
      <View style={styles.dateBlock}>
        <Num size={20} style={{ color: caution ? colors.caution : colors.text }}>{monthDay(item.dueOn)}</Num>
        <Text style={styles.dateWeekday}>{`（${weekday(item.dueOn)}）`}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText numberOfLines={2} style={{ fontFamily: fonts.semibold }}>{item.label}</AppText>
        <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: caution ? colors.caution : colors.textSecondary }}>
          {daysLeft(item.remainingDays)}
          {item.estimated ? '（推定）' : ''}
        </Text>
      </View>
      <Badge label={badge.label} tone={badge.tone} />
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const useStyles = themedStyles((colors) =>
  StyleSheet.create({
    stat: { flex: 1, gap: 2, borderRadius: radius.chip, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, backgroundColor: colors.background },
    /** 見出しと「推定」バッジ。入りきらないときはバッジを次の行に送る（重ねない） */
    titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: spacing.xs },
    statLabel: { fontFamily: fonts.medium, fontSize: 11, color: colors.textSecondary },
    statSub: { fontFamily: fonts.medium, fontSize: 11, color: colors.textSecondary },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 64,
      backgroundColor: colors.card,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      ...cardShadow,
    },
    dateBlock: { width: 56, alignItems: 'center', paddingRight: spacing.md, borderRightWidth: 1, borderRightColor: colors.border },
    dateWeekday: { fontFamily: fonts.medium, fontSize: 11, color: colors.textSecondary },
  }),
);
