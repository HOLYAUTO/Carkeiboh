import { router } from 'expo-router';
import { Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ANNOUNCEMENT_LABELS } from '@domain/announcements.ts';
import { StaffOnly } from '../../../components/StaffOnly';
import { AppText, Badge, Button, Card, Divider, EmptyState, ErrorView, Loading, Screen } from '../../../components/ui';
import { ANNOUNCEMENT_STATUS_LABELS, announcementStatus, useManagedAnnouncements } from '../../../lib/announcements';
import { jstDateTime } from '../../../lib/format';
import { STAFF_ORG_LABELS, type StaffOrg } from '../../../lib/staff';
import { fonts, MIN_TAP, spacing, useColors } from '../../../theme';

/** お知らせの管理（運営スタッフ）。下書き・予約・掲載終了も含めて新しい順に並べる */
export default function ManageAnnouncements() {
  return <StaffOnly>{(org) => <List org={org} />}</StaffOnly>;
}

function List({ org }: { org: StaffOrg }) {
  const colors = useColors();
  const list = useManagedAnnouncements();
  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => list.refetch()} />;
  const items = list.data;

  return (
    <Screen refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={colors.textSecondary} />}>
      <AppText variant="caption">
        {org === 'holy'
          ? 'アップデート・修正のお知らせと、たにぐち自動車の最新情報（代理）を出せます。'
          : 'たにぐち自動車の最新情報を出せます。最新情報は「受け取る」を選んだ利用者だけに届きます。'}
      </AppText>
      <Button title="新しいお知らせを書く" icon="create-outline" onPress={() => router.push({ pathname: '/admin/announcements/[id]', params: { id: 'new' } })} />

      {items.length === 0 ? (
        <Card>
          <EmptyState icon="megaphone-outline" title="お知らせはまだありません" />
        </Card>
      ) : (
        <Card style={{ gap: 0, paddingVertical: spacing.sm }}>
          {items.map((a, i) => {
            const status = announcementStatus(a);
            const editable = org === 'holy' || a.category === 'shop_news';
            return (
              <View key={a.id}>
                {i > 0 && <Divider />}
                <Pressable
                  accessibilityRole="button"
                  disabled={!editable}
                  onPress={() => router.push({ pathname: '/admin/announcements/[id]', params: { id: a.id } })}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: MIN_TAP + 16, paddingVertical: spacing.md, opacity: pressed ? 0.6 : 1 })}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      <Badge label={ANNOUNCEMENT_STATUS_LABELS[status]} tone={status === 'live' ? 'accent' : status === 'scheduled' ? 'caution' : 'neutral'} />
                      {a.send_push && <Badge label={a.pushed_at ? '通知 送信済み' : '通知 送信予定'} tone="neutral" />}
                    </View>
                    <AppText numberOfLines={2} style={{ fontFamily: fonts.semibold }}>{a.title}</AppText>
                    <AppText variant="caption">
                      {ANNOUNCEMENT_LABELS[a.category]}・{jstDateTime(a.published_at)}・{STAFF_ORG_LABELS[a.org]}
                    </AppText>
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
