import { router } from 'expo-router';
import { View } from 'react-native';
import { ANNOUNCEMENT_LABELS } from '@domain/announcements.ts';
import type { AnnouncementRow as Announcement } from '../lib/announcements';
import { jstDate } from '../lib/format';
import { fonts, spacing } from '../theme';
import { AppText, Badge, PressableRow } from './ui';

/** お知らせ一覧の1行。押すと本文を開く。未読なら「NEW」を付ける */
export function AnnouncementRow({ announcement: a, isNew, showBody }: { announcement: Announcement; isNew: boolean; showBody?: boolean }) {
  return (
    <PressableRow
      accessibilityLabel={`${isNew ? '未読。' : ''}${ANNOUNCEMENT_LABELS[a.category]}。${a.title}`}
      onPress={() => router.push({ pathname: '/announcements/[id]', params: { id: a.id } })}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: spacing.xs }}>
        {isNew && <Badge label="NEW" />}
        <AppText variant="caption">
          {ANNOUNCEMENT_LABELS[a.category]}・{jstDate(a.published_at)}
        </AppText>
      </View>
      <AppText numberOfLines={2} style={{ fontFamily: fonts.semibold }}>
        {a.title}
      </AppText>
      {showBody && (
        <AppText variant="caption" numberOfLines={2}>
          {a.body}
        </AppText>
      )}
    </PressableRow>
  );
}
