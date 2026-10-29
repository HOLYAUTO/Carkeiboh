import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { ANNOUNCEMENT_LABELS } from '@domain/announcements.ts';
import { setShopNewsOptIn, useAnnouncements } from '../lib/announcements';
import { useAppUpdate } from '../lib/app-updates';
import { jstDateTime } from '../lib/format';
import { registerForPush } from '../lib/push';
import { fonts, MIN_TAP, spacing, useColors } from '../theme';
import { AppText, Button, Card, Divider } from './ui';

/** ホームの上に出すお知らせ：修正の反映待ち／新しいお知らせ／たにぐち自動車の最新情報の案内 */
export function HomeNotices() {
  return (
    <>
      <AppUpdateCard />
      <UnreadAnnouncements />
      <ShopNewsInvite />
    </>
  );
}

/** EAS Update で配った修正を取り込み終わったら、再起動で反映できることを知らせる */
function AppUpdateCard() {
  const colors = useColors();
  const update = useAppUpdate();
  if (!update.ready) return null;
  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Ionicons name="sparkles-outline" size={16} color={colors.accentText} />
        <AppText variant="heading" style={{ flexShrink: 1 }}>アプリの修正が届きました</AppText>
      </View>
      <AppText variant="caption">再起動すると新しい版になります。入力中の内容がある場合は、保存してから再起動してください。</AppText>
      <Button title="再起動して反映する" icon="refresh" onPress={update.restart} />
    </Card>
  );
}

/** 一覧をまだ開いていない新しいお知らせ（2件まで） */
function UnreadAnnouncements() {
  const colors = useColors();
  const { unread } = useAnnouncements();
  if (!unread || unread.length === 0) return null;
  return (
    <Card style={{ gap: spacing.sm, paddingVertical: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 }}>
          <Ionicons name="megaphone-outline" size={16} color={colors.accentText} />
          <AppText variant="heading" style={{ flexShrink: 1 }}>新しいお知らせ</AppText>
          <View style={{ backgroundColor: colors.accent, borderRadius: 999, minWidth: 20, paddingHorizontal: 6, alignItems: 'center' }}>
            <Text accessibilityLabel={`${unread.length}件`} style={{ fontFamily: fonts.numMedium, fontSize: 12, lineHeight: 18, color: colors.onAccent }}>
              {unread.length}
            </Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.push('/announcements')} style={{ minHeight: MIN_TAP, justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary }}>すべて見る →</Text>
        </Pressable>
      </View>
      {unread.slice(0, 2).map((a, i) => (
        <View key={a.id}>
          {i > 0 && <Divider />}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${ANNOUNCEMENT_LABELS[a.category]}。${a.title}`}
            onPress={() => router.push({ pathname: '/announcements/[id]', params: { id: a.id } })}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: MIN_TAP + 8, paddingVertical: spacing.xs, opacity: pressed ? 0.6 : 1 })}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="caption">
                {ANNOUNCEMENT_LABELS[a.category]}・{jstDateTime(a.published_at).slice(0, 10)}
              </AppText>
              <AppText numberOfLines={2} style={{ fontFamily: fonts.semibold }}>{a.title}</AppText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>
        </View>
      ))}
    </Card>
  );
}

/**
 * たにぐち自動車の最新情報を受け取るかを、まだ選んでいない利用者に一度だけ聞く。
 * 宣伝を含むため、選んでもらうまでは送らない（App Store の審査ガイドライン 4.5.4）
 */
function ShopNewsInvite() {
  const colors = useColors();
  const qc = useQueryClient();
  const { prefs } = useAnnouncements();
  const [busy, setBusy] = useState(false);
  if (!prefs || prefs.shopNewsOptIn !== null) return null;

  const choose = async (optIn: boolean) => {
    setBusy(true);
    try {
      await setShopNewsOptIn(optIn);
      if (optIn) await registerForPush(true).catch(() => {});
      await qc.invalidateQueries({ queryKey: ['announcementPrefs'] });
    } catch (e) {
      Alert.alert('保存できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Ionicons name="storefront-outline" size={16} color={colors.accentText} />
        <AppText variant="heading" style={{ flexShrink: 1 }}>たにぐち自動車の最新情報を受け取りますか</AppText>
      </View>
      <AppText variant="caption">
        新しいサービス・キャンペーン・営業日のお知らせなどを、ホームと通知でお届けします。通知タブからいつでも止められます。
      </AppText>
      <Button title="受け取る" loading={busy} onPress={() => choose(true)} />
      <Button title="受け取らない" variant="plain" disabled={busy} onPress={() => choose(false)} />
    </Card>
  );
}
