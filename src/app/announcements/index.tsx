import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ANNOUNCEMENT_LABELS, type AnnouncementCategory } from '@domain/announcements.ts';
import { AppText, Badge, Button, Card, Divider, EmptyState, ErrorView, Loading, Screen, Segmented } from '../../components/ui';
import { markAnnouncementsSeen, setShopNewsOptIn, useAnnouncements } from '../../lib/announcements';
import { jstDateTime } from '../../lib/format';
import { registerForPush } from '../../lib/push';
import { fonts, MIN_TAP, spacing, useColors } from '../../theme';

type Filter = 'all' | AnnouncementCategory;

/** お知らせの一覧。開いている間は未読に「NEW」を付け、画面を離れたら既読にする */
export default function Announcements() {
  const colors = useColors();
  const qc = useQueryClient();
  const { visible, prefs, isPending, isError, isRefetching, refetch } = useAnnouncements();
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  // 開いた時点の既読の日時。画面を離れるまで NEW の表示を残す
  const [seenAtOnOpen, setSeenAtOnOpen] = useState<string | null | undefined>(undefined);
  if (prefs && seenAtOnOpen === undefined) setSeenAtOnOpen(prefs.seenAt);

  useFocusEffect(
    useCallback(
      () => () => {
        markAnnouncementsSeen()
          .then(() => qc.invalidateQueries({ queryKey: ['announcementPrefs'] }))
          .catch(() => {});
      },
      [qc],
    ),
  );

  if (isPending) return <Loading />;
  if (isError || !visible || !prefs) return <ErrorView message="読み込めませんでした。" onRetry={() => void refetch()} />;

  const optedIn = prefs.shopNewsOptIn === true;
  const items = filter === 'all' ? visible : visible.filter((a) => a.category === filter);
  const seenAt = seenAtOnOpen ? Date.parse(seenAtOnOpen) : null;

  const optIn = async () => {
    setBusy(true);
    try {
      await setShopNewsOptIn(true);
      await registerForPush(true).catch(() => {});
      await qc.invalidateQueries({ queryKey: ['announcementPrefs'] });
    } catch (e) {
      Alert.alert('保存できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.textSecondary} />}>
      {optedIn ? (
        <Segmented<Filter>
          options={[
            { value: 'all', label: 'すべて' },
            { value: 'app_update', label: 'アップデート' },
            { value: 'shop_news', label: 'たにぐち自動車' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      ) : (
        <Card style={{ gap: spacing.sm }}>
          <AppText variant="heading">たにぐち自動車の最新情報</AppText>
          <AppText variant="caption">
            受け取らない設定です。新しいサービス・キャンペーン・営業日のお知らせなどを、ホームと通知でお届けします。通知タブからいつでも止められます。
          </AppText>
          <Button title="受け取る" variant="secondary" loading={busy} onPress={optIn} />
        </Card>
      )}

      {items.length === 0 ? (
        <Card>
          <EmptyState icon="megaphone-outline" title="お知らせはまだありません" description="アプリの修正や新しい機能をお知らせします。" />
        </Card>
      ) : (
        <Card style={{ gap: 0, paddingVertical: spacing.sm }}>
          {items.map((a, i) => {
            const isNew = seenAt == null || Date.parse(a.published_at) > seenAt;
            return (
              <View key={a.id}>
                {i > 0 && <Divider />}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${isNew ? '未読。' : ''}${ANNOUNCEMENT_LABELS[a.category]}。${a.title}`}
                  onPress={() => router.push({ pathname: '/announcements/[id]', params: { id: a.id } })}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: MIN_TAP + 16, paddingVertical: spacing.md, opacity: pressed ? 0.6 : 1 })}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: spacing.xs }}>
                      {isNew && <Badge label="NEW" />}
                      <AppText variant="caption">{ANNOUNCEMENT_LABELS[a.category]}・{jstDateTime(a.published_at).slice(0, 10)}</AppText>
                    </View>
                    <AppText numberOfLines={2} style={{ fontFamily: fonts.semibold }}>{a.title}</AppText>
                    <AppText variant="caption" numberOfLines={2}>{a.body}</AppText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}
