import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { AppText, Button, Card, Screen } from '../components/ui';
import { config } from '../lib/config';
import { colors, spacing } from '../theme';

const BENEFITS = [
  '家族や仕事のクルマをまとめて登録（最大5台）',
  'オイル交換・車検・保険の通知を1台ずつ受け取る',
  '維持費をクルマごとに集計',
];

/**
 * 複数台プランの案内。
 * 【要確認】価格・課金の仕組み（App Store / Google Play のアプリ内課金）は未定のため、申し込みボタンは「準備中」にしている
 */
export default function Plan() {
  return (
    <Screen>
      <Card>
        <AppText variant="heading">複数台プラン</AppText>
        <AppText variant="caption">1台目は無料のまま。2台目からはこちらのプランでご利用いただけます。</AppText>
        <View style={{ gap: spacing.sm }}>
          {BENEFITS.map((b) => (
            <View key={b} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.accentText} style={{ marginTop: 1 }} />
              <AppText style={{ flex: 1 }}>{b}</AppText>
            </View>
          ))}
        </View>
        <AppText variant="label">{config.plusPriceLabel || '料金：準備中'}</AppText>
      </Card>
      <Button title="準備中です" disabled onPress={() => {}} />
      <AppText variant="caption" style={{ textAlign: 'center' }}>お申し込みの受付を始めたら、アプリでお知らせします。</AppText>
    </Screen>
  );
}
