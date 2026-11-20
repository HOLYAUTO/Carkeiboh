import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addDays, addMonths, startOfMonth } from '@domain/dates.ts';
import { StaffOnly } from '../../../components/StaffOnly';
import { AppText, Badge, Button, Card, Divider, EmptyState, Num, QueryFallback, Screen, Segmented } from '../../../components/ui';
import { todayJst } from '../../../lib/data';
import { fullDate, number } from '../../../lib/format';
import { isSponsorLive, SPONSOR_PLACEMENT_LABELS } from '../../../lib/sponsor-pick';
import { useManagedSponsorAds, useSponsorStats, type SponsorAdRow } from '../../../lib/sponsors';
import { STAFF_ORG_LABELS, type StaffOrg } from '../../../lib/staff';
import { fonts, MIN_TAP, spacing, useColors } from '../../../theme';

type Period = 'this' | 'last';

/** スポンサー広告の管理（運営スタッフ）。掲載の状態と、期間ごとの表示・タップの数を並べる */
export default function ManageSponsors() {
  return <StaffOnly>{(org) => <List org={org} />}</StaffOnly>;
}

function sponsorStatus(ad: SponsorAdRow, today: string): { label: string; tone: 'accent' | 'caution' | 'neutral' } {
  if (!ad.is_published) return { label: '下書き', tone: 'neutral' };
  if (isSponsorLive(ad, today)) return { label: '掲載中', tone: 'accent' };
  if (ad.starts_on > today) return { label: '掲載前', tone: 'caution' };
  return { label: '掲載終了', tone: 'neutral' };
}

function List({ org }: { org: StaffOrg }) {
  const colors = useColors();
  const today = todayJst();
  const [period, setPeriod] = useState<Period>('this');
  const thisMonth = startOfMonth(today);
  const from = period === 'this' ? thisMonth : addMonths(thisMonth, -1);
  const to = period === 'this' ? today : addDays(thisMonth, -1);
  const ads = useManagedSponsorAds();
  const stats = useSponsorStats(from, to);

  if (!ads.isSuccess) return <QueryFallback queries={[ads]} />;

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={ads.isRefetching || stats.isRefetching}
          onRefresh={() => void Promise.all([ads.refetch(), stats.refetch()])}
          tintColor={colors.textSecondary}
        />
      }
    >
      <AppText variant="caption">
        外部の広告サービスは使わず、ここで登録した広告だけをホーム・維持費・整備工場の画面に出します（「PR」と広告主の名前を必ず表示）。
        {org === 'holy' ? 'HOLY はすべての広告を編集できます。' : '自社の広告を編集できます。他社の広告は見るだけです。'}
      </AppText>
      <Button title="新しい広告を登録する" icon="add" onPress={() => router.push({ pathname: '/admin/sponsors/[id]', params: { id: 'new' } })} />

      <Segmented<Period>
        options={[
          { value: 'this', label: '今月' },
          { value: 'last', label: '先月' },
        ]}
        value={period}
        onChange={setPeriod}
      />
      <AppText variant="caption">
        {fullDate(from)}〜{fullDate(to)} の表示回数・タップ数（同じ起動のあいだの同じ画面での表示は1回と数えます）
      </AppText>

      {ads.data.length === 0 ? (
        <Card>
          <EmptyState icon="pricetags-outline" title="広告はまだありません" />
        </Card>
      ) : (
        <Card style={{ gap: 0, paddingVertical: spacing.sm }}>
          {ads.data.map((ad, i) => {
            const status = sponsorStatus(ad, today);
            const editable = org === 'holy' || ad.org === org;
            const s = stats.data?.get(ad.id);
            return (
              <View key={ad.id}>
                {i > 0 && <Divider />}
                <Pressable
                  accessibilityRole="button"
                  disabled={!editable}
                  onPress={() => router.push({ pathname: '/admin/sponsors/[id]', params: { id: ad.id } })}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: MIN_TAP + 16, paddingVertical: spacing.md, opacity: pressed ? 0.6 : 1 })}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      <Badge label={status.label} tone={status.tone} />
                      {!editable && <Badge label="閲覧のみ" tone="neutral" />}
                    </View>
                    <AppText numberOfLines={2} style={{ fontFamily: fonts.semibold }}>{ad.title}</AppText>
                    <AppText variant="caption">
                      {ad.sponsor_name}・管理 {STAFF_ORG_LABELS[ad.org]}
                    </AppText>
                    <AppText variant="caption">
                      {ad.placements.map((p) => SPONSOR_PLACEMENT_LABELS[p]).join('・')}／{fullDate(ad.starts_on)}〜{ad.ends_on ? fullDate(ad.ends_on) : ''}／重み {ad.weight}
                    </AppText>
                    {editable && (
                      <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: 2 }}>
                        <Stat label="表示" value={s ? number(s.impressions) : '0'} />
                        <Stat label="タップ" value={s ? number(s.clicks) : '0'} />
                        <Stat label="タップ率" value={s && s.impressions > 0 ? `${((s.clicks / s.impressions) * 100).toFixed(1)}%` : '—'} />
                      </View>
                    )}
                  </View>
                  {editable && <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />}
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 0 }}>
      <AppText variant="caption">{label}</AppText>
      <Num size={16}>{value}</Num>
    </View>
  );
}
