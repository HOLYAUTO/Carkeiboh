import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { todayJst } from '../lib/data';
import { pickSponsorAd, type SponsorPlacement } from '../lib/sponsor-pick';
import { logSponsorEvent, sponsorImageUrl, useSponsorAds } from '../lib/sponsors';
import { fonts, radius, spacing, themedStyles, useColors } from '../theme';
import { AppText } from './ui';

/** 広告の画像の縦横比（横 2：縦 1）。登録画面でもこの形に切り抜く */
export const SPONSOR_IMAGE_ASPECT = 2;

export interface SponsorCardContent {
  sponsorName: string;
  title: string;
  body: string | null;
  imageUri: string | null;
  linkUrl: string | null;
}

/**
 * スポンサー広告の見た目。広告であることが分かるよう、必ず「PR」と広告主の名前を出す。
 * 登録画面のプレビューでも同じものを使う
 */
export function SponsorCard({ ad, onPress }: { ad: SponsorCardContent; onPress?: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole={onPress ? 'link' : undefined}
      accessibilityLabel={`広告。${ad.sponsorName}。${ad.title}${ad.linkUrl ? '。押すと詳しい内容を開きます' : ''}`}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
    >
      {ad.imageUri && (
        <Image source={{ uri: ad.imageUri }} style={styles.image} contentFit="cover" cachePolicy="memory-disk" transition={150} accessible={false} />
      )}
      <View style={styles.content}>
        <View style={styles.labelRow}>
          <View style={styles.pr}>
            <Text style={styles.prText}>PR</Text>
          </View>
          <Text numberOfLines={1} style={styles.sponsor}>{ad.sponsorName}</Text>
        </View>
        <AppText variant="heading" numberOfLines={2}>{ad.title}</AppText>
        {ad.body ? <AppText variant="caption" numberOfLines={3}>{ad.body}</AppText> : null}
        {ad.linkUrl && (
          <View style={styles.more}>
            <Text style={styles.moreText}>詳しく見る</Text>
            <Ionicons name="open-outline" size={14} color={colors.accentText} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

/**
 * スポンサー広告枠。その場所に出せる掲載中の広告から、重みに応じて1件を選んで出す（なければ何も出さない）。
 * 画面を開いている間は同じ広告を出し続け、表示とタップを記録する
 */
export function SponsorSlot({ placement }: { placement: SponsorPlacement }) {
  const ads = useSponsorAds();
  const [random] = useState(() => Math.random());
  const ad = useMemo(() => (ads.data ? pickSponsorAd(ads.data, placement, todayJst(), random) : null), [ads.data, placement, random]);

  useEffect(() => {
    if (ad) logSponsorEvent(ad.id, 'impression', placement);
  }, [ad, placement]);

  if (!ad) return null;
  const link = ad.link_url;
  return (
    <SponsorCard
      ad={{
        sponsorName: ad.sponsor_name,
        title: ad.title,
        body: ad.body,
        imageUri: ad.image_path ? sponsorImageUrl(ad.image_path) : null,
        linkUrl: link,
      }}
      onPress={
        link
          ? () => {
              logSponsorEvent(ad.id, 'click', placement);
              WebBrowser.openBrowserAsync(link).catch(() => {});
            }
          : undefined
      }
    />
  );
}

const useStyles = themedStyles((colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    image: { width: '100%', aspectRatio: SPONSOR_IMAGE_ASPECT, backgroundColor: colors.surfaceVariant },
    content: { padding: spacing.lg, gap: spacing.xs },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    pr: { borderRadius: radius.chip, borderWidth: 1, borderColor: colors.textSecondary, paddingHorizontal: 5, paddingVertical: 0 },
    prText: { fontFamily: fonts.numMedium, fontSize: 11, lineHeight: 15, letterSpacing: 1, color: colors.textSecondary },
    sponsor: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary },
    more: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
    moreText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accentText },
  }),
);
