import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl } from 'react-native';
import { type AnnouncementCategory } from '@domain/announcements.ts';
import { AppText, Button, Card, EmptyState, ErrorView, ListCard, Loading, Screen, Segmented } from '../../components/ui';
import { AnnouncementRow } from '../../components/AnnouncementRow';
import { markAnnouncementsSeen, setShopNewsOptIn, useAnnouncements } from '../../lib/announcements';
import { registerForPush } from '../../lib/push';
import { spacing, useColors } from '../../theme';
import { alertError } from '../../lib/alerts';

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
      alertError('保存できませんでした', e);
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
        <ListCard>
          {items.map((a) => (
            <AnnouncementRow key={a.id} announcement={a} isNew={seenAt == null || Date.parse(a.published_at) > seenAt} showBody />
          ))}
        </ListCard>
      )}
    </Screen>
  );
}
