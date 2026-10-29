import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ANNOUNCEMENT_LABELS } from '@domain/announcements.ts';
import { AppText, Badge, Button, Card, EmptyState, ErrorView, Loading, Screen } from '../../components/ui';
import { useAnnouncement } from '../../lib/announcements';
import { jstDateTime } from '../../lib/format';
import { spacing } from '../../theme';

export default function AnnouncementDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const announcement = useAnnouncement(id);

  if (announcement.isPending) return <Loading />;
  if (announcement.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => announcement.refetch()} />;
  const a = announcement.data;
  if (!a) {
    return (
      <Screen>
        <Card>
          <EmptyState icon="megaphone-outline" title="このお知らせは掲載が終わりました" />
        </Card>
      </Screen>
    );
  }
  const link = a.link_url;

  return (
    <Screen>
      <Card style={{ gap: spacing.sm }}>
        <Badge label={ANNOUNCEMENT_LABELS[a.category]} tone={a.category === 'shop_news' ? 'accent' : 'neutral'} />
        <AppText variant="title" accessibilityRole="header">{a.title}</AppText>
        <AppText variant="caption">{jstDateTime(a.published_at)}</AppText>
        <AppText selectable style={{ marginTop: spacing.sm }}>{a.body}</AppText>
        {link && (
          <Button title={a.link_label ?? '詳しく見る'} icon="open-outline" variant="secondary" onPress={() => WebBrowser.openBrowserAsync(link).catch(() => {})} />
        )}
      </Card>
    </Screen>
  );
}
