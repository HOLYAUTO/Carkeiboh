import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { ACCENT_IDS, ACCENTS, BASE_IDS, BASES, buildPalette, type AccentId, type BaseId } from '../../palettes';
import { AppText, Badge, Card, NextActionCard, ProgressRing, Screen, SectionTitle } from '../../components/ui';
import { fonts, MIN_TAP, radius, spacing, useColors, useTheme } from '../../theme';

/** 画面の色。明るさ（ダーク／ライト）とアクセントカラーを選ぶと、その場で全画面に反映し、端末に覚えておく */
export default function Appearance() {
  const colors = useColors();
  const { choice, setChoice } = useTheme();

  return (
    <Screen>
      <AppText variant="caption">選ぶとすぐに反映します。この端末に保存され、次に開いたときも同じ色で表示します。</AppText>

      {/* 今の色で、ホームの主な部品を小さく並べて見せる */}
      <View accessibilityLabel="見本" style={{ gap: spacing.sm }}>
        <NextActionCard title="オイル交換の時期です" reason="推定であと820km・目安日まであと22日。" cta="オイル交換を記録する" onPress={() => {}} />
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <ProgressRing value={0.72} size={52} strokeWidth={5} label="見本の進み具合" />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <AppText style={{ fontFamily: fonts.semibold }}>フィルター交換まで</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              <Badge label="推定" tone="neutral" />
              <Badge label="予定" />
              <Badge label="もうすぐ" tone="caution" />
            </View>
          </View>
        </Card>
      </View>

      <SectionTitle>画面の明るさ</SectionTitle>
      <View style={{ flexDirection: 'row', gap: spacing.sm }} accessibilityRole="radiogroup">
        {BASE_IDS.map((id) => (
          <BaseOption key={id} id={id} selected={choice.base === id} onPress={() => setChoice({ ...choice, base: id })} />
        ))}
      </View>

      <SectionTitle>アクセントカラー</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: spacing.xs }}>
        <View accessibilityRole="radiogroup">
          {ACCENT_IDS.map((id, i) => (
            <AccentOption
              key={id}
              id={id}
              base={choice.base}
              first={i === 0}
              selected={choice.accent === id}
              onPress={() => setChoice({ ...choice, accent: id })}
            />
          ))}
        </View>
      </Card>
      <AppText variant="caption" style={{ marginHorizontal: spacing.xs }}>
        期限切れなどの注意の表示は、どの色を選んでも見分けやすいよう
        <Text style={{ color: colors.caution, fontFamily: fonts.semibold }}>琥珀色</Text>
        のままにしています。
      </AppText>
    </Screen>
  );
}

function BaseOption({ id, selected, onPress }: { id: BaseId; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const base = BASES[id];
  const preview = base.colors;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${base.label}。${base.description}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: MIN_TAP * 2,
        borderRadius: radius.card,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: colors.card,
        padding: spacing.md,
        gap: spacing.sm,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {/* 画面の見本：背景・カード・文字の色 */}
      <View style={{ height: 44, borderRadius: radius.control, backgroundColor: preview.background, borderWidth: 1, borderColor: preview.border, padding: 6, gap: 4 }}>
        <View style={{ height: 10, width: '70%', borderRadius: 3, backgroundColor: preview.text }} />
        <View style={{ height: 16, borderRadius: 4, backgroundColor: preview.card, borderWidth: 1, borderColor: preview.border }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={selected ? colors.accentText : colors.textSecondary} />
        <AppText style={{ fontFamily: fonts.semibold }}>{base.label}</AppText>
      </View>
      <AppText variant="caption">{base.description}</AppText>
    </Pressable>
  );
}

function AccentOption({ id, base, first, selected, onPress }: { id: AccentId; base: BaseId; first: boolean; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const accent = ACCENTS[id];
  // 今の明るさで実際に使う塗りの色を見せる
  const swatch = buildPalette({ base, accent: id });
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${accent.label}。${accent.note}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: MIN_TAP + 12,
        paddingVertical: spacing.sm,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: swatch.accent, alignItems: 'center', justifyContent: 'center' }}>
        {selected && <Ionicons name="checkmark" size={18} color={swatch.onAccent} />}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText style={{ fontFamily: fonts.semibold }}>{accent.label}</AppText>
        <AppText variant="caption">{accent.note}</AppText>
      </View>
      {selected && <AppText variant="caption" style={{ color: colors.accentText }}>選択中</AppText>}
    </Pressable>
  );
}
