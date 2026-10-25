import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import Svg, { Circle } from 'react-native-svg';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, cardShadow, fonts, MIN_TAP, radius, spacing } from '../theme';
import { dateToIso, fullDate, isoToDate } from '../lib/format';

type Variant = 'title' | 'heading' | 'body' | 'label' | 'caption';

const variantStyles: Record<Variant, TextStyle> = {
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 30 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 24 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
};

export function AppText({ variant = 'body', style, ...rest }: TextProps & { variant?: Variant }) {
  return <Text {...rest} style={[{ color: colors.text }, variantStyles[variant], style]} />;
}

/** 金額・距離・日付用の数字（Saira の等幅数字 tnum で桁をそろえる） */
export function Num({ size = 15, style, ...rest }: TextProps & { size?: number }) {
  return (
    <Text
      {...rest}
      style={[{ color: colors.text, fontFamily: size >= 20 ? fonts.numMedium : fonts.num, fontSize: size, fontVariant: ['tabular-nums'] }, style]}
    />
  );
}

export function Screen({
  children,
  scroll = true,
  header,
  refreshControl,
}: {
  children: ReactNode;
  scroll?: boolean;
  /** タブ画面の見出し（ScreenHeader）。スクロールと一緒に流れる */
  header?: ReactNode;
  refreshControl?: ComponentProps<typeof ScrollView>['refreshControl'];
}) {
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>
          {header}
          <View style={styles.screenContent}>{children}</View>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {header}
          <View style={[styles.screenContent, { flex: 1 }]}>{children}</View>
        </View>
      )}
    </SafeAreaView>
  );
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={[styles.center, { padding: spacing.xl, gap: spacing.md }]}>
      <AppText style={{ textAlign: 'center' }}>{message}</AppText>
      {onRetry && <Button title="再読み込み" variant="secondary" onPress={onRetry} />}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** セクション見出し。右に「すべて見る」などの導線を置ける */
export function SectionTitle({ children, action }: { children: ReactNode; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md }}>
      <AppText variant="heading" style={{ fontSize: 16 }}>{children}</AppText>
      {action && (
        <Pressable accessibilityRole="button" onPress={action.onPress} style={{ minHeight: MIN_TAP, justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary }}>{action.label} →</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'plain' | 'destructive';
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const fg =
    variant === 'primary' ? colors.white : variant === 'destructive' ? colors.caution : colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: colors.accent },
        variant === 'secondary' && { backgroundColor: colors.accentSoft },
        variant === 'destructive' && { backgroundColor: colors.cautionBackground },
        (disabled || loading) && { opacity: 0.4 },
        pressed && { opacity: 0.7 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <Text style={{ color: fg, fontFamily: fonts.semibold, fontSize: 16 }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** 注意表示（オレンジ系はこれだけに使う）。色だけでなく文字とアイコンでも伝える */
export function Notice({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <View style={styles.notice} accessibilityRole="alert">
      <Ionicons name="warning-outline" size={18} color={colors.caution} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title && <Text style={{ color: colors.caution, fontFamily: fonts.semibold, fontSize: 14 }}>{title}</Text>}
        <Text style={{ color: colors.caution, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 }}>{children}</Text>
      </View>
    </View>
  );
}

/** 状態の小さなピル。色だけでなく必ず文字で状態を書く */
export function Badge({ label, tone = 'accent' }: { label: string; tone?: 'accent' | 'caution' | 'neutral' }) {
  const fg = tone === 'accent' ? colors.accent : tone === 'caution' ? colors.caution : colors.textSecondary;
  const bg = tone === 'accent' ? colors.accentSoft : tone === 'caution' ? colors.cautionBackground : colors.surfaceVariant;
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 }}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ value, tone = 'accent', label }: { value: number; tone?: 'accent' | 'caution'; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{ height: 8, borderRadius: 4, backgroundColor: colors.track, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: tone === 'caution' ? colors.caution : colors.accent }} />
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text style={{ fontFamily: selected ? fonts.semibold : fonts.medium, fontSize: 14, color: selected ? colors.text : colors.textSecondary }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({
  label,
  hint,
  suffix,
  ...input
}: TextInputProps & { label: string; hint?: string; suffix?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label">{label}</AppText>
      <View style={styles.inputWrap}>
        <TextInput
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel={label}
          {...input}
          style={[styles.input, input.keyboardType === 'number-pad' && { fontFamily: fonts.num }]}
        />
        {suffix && <AppText variant="label">{suffix}</AppText>}
      </View>
      {hint && <AppText variant="caption">{hint}</AppText>}
    </View>
  );
}

/** 日付の入力。iOS は端末の小さな日付ピッカー、Android はダイアログ */
export function DateField({
  label,
  value,
  onChange,
  optional,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  optional?: boolean;
}) {
  const current = value ? isoToDate(value) : new Date();
  const open = () =>
    DateTimePickerAndroid.open({
      value: current,
      mode: 'date',
      onValueChange: (_e, d) => onChange(dateToIso(d)),
    });
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label">{label}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {Platform.OS === 'ios' && value ? (
          <DateTimePicker value={current} mode="date" display="compact" locale="ja-JP" onValueChange={(_e, d) => onChange(dateToIso(d))} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}を選ぶ`}
            onPress={() => (value || Platform.OS === 'android' ? open() : onChange(dateToIso(new Date())))}
            style={[styles.inputWrap, { flex: 1 }]}
          >
            <Num style={{ flex: 1, color: value ? colors.text : colors.textSecondary }}>{value ? fullDate(value) : '未設定'}</Num>
            <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
        {optional && value && (
          <Pressable accessibilityRole="button" accessibilityLabel={`${label}を未設定にする`} onPress={() => onChange(null)} style={styles.iconButton}>
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function ToggleRow({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText>{title}</AppText>
        {description && <AppText variant="caption">{description}</AppText>}
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.track }}
      />
    </View>
  );
}

export function ListRow({
  title,
  detail,
  onPress,
  right,
  destructive,
}: {
  title: string;
  detail?: string;
  onPress?: () => void;
  right?: ReactNode;
  destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <AppText style={destructive ? { color: colors.caution } : undefined}>{title}</AppText>
        {detail && <AppText variant="caption">{detail}</AppText>}
      </View>
      {right}
      {onPress && <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}
    </Pressable>
  );
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xxxl * 2, gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.xl, gap: spacing.md, ...cardShadow },
  button: { minHeight: MIN_TAP + 4, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  notice: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.cautionBackground, borderRadius: radius.control, padding: spacing.md },
  segmented: { flexDirection: 'row', backgroundColor: colors.surfaceVariant, borderRadius: radius.control, padding: 3 },
  segment: { flex: 1, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control - 2 },
  segmentSelected: {
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  inputWrap: {
    minHeight: MIN_TAP + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, minHeight: MIN_TAP, fontFamily: fonts.regular, fontSize: 16, color: colors.text },
  iconButton: { minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' },
  row: { minHeight: MIN_TAP + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
});

/** 四角いアイコンボタン（44px）。読み上げ用のラベル必須 */
export function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: MIN_TAP,
        height: MIN_TAP,
        borderRadius: radius.control,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: colors.card,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

/**
 * タブ画面の見出し。ナビゲーションの帯は出さず、画面の上端に小さな補足と大きな見出しを置く。
 * 右上は設定などのアイコンボタン。
 */
export function ScreenHeader({
  overline,
  title,
  subtitle,
  right,
  onTitlePress,
  titlePressLabel,
}: {
  overline?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  /** 見出しを押せるようにする（ホームの車名から車両を切り替えるなど）。押せることを ▼ で示す */
  onTitlePress?: () => void;
  titlePressLabel?: string;
}) {
  const insets = useSafeAreaInsets();
  const titleText = (
    <Text accessibilityRole="header" style={{ fontFamily: fonts.semibold, fontSize: 24, lineHeight: 32, color: colors.text, flexShrink: 1 }}>
      {title}
    </Text>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm, gap: spacing.md }}>
      <View style={{ flex: 1 }}>
        {overline && (
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.textSecondary, letterSpacing: 0.5 }}>{overline}</Text>
        )}
        {onTitlePress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={titlePressLabel ?? title}
            onPress={onTitlePress}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: MIN_TAP, opacity: pressed ? 0.6 : 1 })}
          >
            {titleText}
            <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : (
          titleText
        )}
        {subtitle && <Text style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

/** 円形の進み具合。中央に割合を文字でも出す */
export function ProgressRing({
  value,
  size = 72,
  strokeWidth = 6,
  tone = 'accent',
  label,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  tone?: 'accent' | 'caution';
  label: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const color = tone === 'caution' ? colors.caution : colors.accent;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.track} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Num size={13} style={{ color }}>{`${pct}%`}</Num>
    </View>
  );
}

/**
 * 「次にすること」。いま一番やるべきことを1つだけ、理由とボタン付きで出す。
 */
export function NextActionCard({
  title,
  reason,
  cta,
  onPress,
  tone = 'accent',
}: {
  title: string;
  reason: string;
  cta: string;
  onPress: () => void;
  tone?: 'accent' | 'caution';
}) {
  const color = tone === 'caution' ? colors.caution : colors.accent;
  const soft = tone === 'caution' ? colors.cautionBackground : colors.accentSoft;
  return (
    <View style={[styles.card, { borderWidth: 1.5, borderColor: color }]}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1, color }}>次にすること</Text>
      <AppText variant="heading">{title}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: soft, borderRadius: radius.chip, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
        <Ionicons name={tone === 'caution' ? 'warning-outline' : 'information-circle-outline'} size={16} color={color} />
        <Text style={{ flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, color }}>{reason}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.button, { backgroundColor: tone === 'caution' ? colors.caution : pressed ? colors.accentPressed : colors.accent }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text style={{ color: colors.white, fontFamily: fonts.semibold, fontSize: 16 }}>{cta}</Text>
          <Ionicons name="arrow-forward" size={18} color={colors.white} />
        </View>
      </Pressable>
    </View>
  );
}

/** 一覧が空のときの表示 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg, gap: spacing.sm }}>
      <Ionicons name={icon} size={36} color={colors.textTertiary} />
      <AppText variant="heading" style={{ textAlign: 'center' }}>{title}</AppText>
      {description && <AppText variant="caption" style={{ textAlign: 'center' }}>{description}</AppText>}
      {action && (
        <View style={{ alignSelf: 'stretch', marginTop: spacing.md }}>
          <Button title={action.label} variant="secondary" onPress={action.onPress} />
        </View>
      )}
    </View>
  );
}

/** 読み込み中の形だけの表示（実際の中身と同じ形に置く） */
export function Skeleton({ height, style }: { height: number; style?: StyleProp<ViewStyle> }) {
  const [opacity] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      accessibilityLabel="読み込み中"
      style={[{ height, borderRadius: radius.card, backgroundColor: colors.surfaceVariant, opacity }, style]}
    />
  );
}
