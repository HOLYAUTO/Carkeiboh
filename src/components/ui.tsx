import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
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
    variant === 'primary' ? colors.white : variant === 'destructive' ? colors.caution : colors.accentText;
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
  const fg = tone === 'accent' ? colors.accentText : tone === 'caution' ? colors.caution : colors.textSecondary;
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
          keyboardAppearance="dark"
          selectionColor={colors.accentText}
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
          <DateTimePicker value={current} mode="date" display="compact" locale="ja-JP" themeVariant="dark" accentColor={colors.accentText} onValueChange={(_e, d) => onChange(dateToIso(d))} />
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
        ios_backgroundColor={colors.track}
        // つまみは白に固定する（指定しないと Android・Web は端末やライブラリの色になり、赤の上で緑などに見える）
        thumbColor={colors.white}
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
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
    ...cardShadow,
  },
  button: { minHeight: MIN_TAP + 4, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  notice: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.cautionBackground, borderRadius: radius.control, padding: spacing.md },
  // 選んでいる項目の下に赤い線を引く切り替え
  segmented: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  segment: { flex: 1, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  segmentSelected: { borderBottomColor: colors.accent },
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
  plate: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.plateText,
    backgroundColor: colors.plateBackground,
  },
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
  tag,
  overline,
  title,
  subtitle,
  plate,
  right,
  onTitlePress,
  titlePressLabel,
}: {
  /** 見出しの上の英字ラベル（GARAGE LOG など）。飾りなので読み上げない */
  tag?: string;
  overline?: string;
  title: string;
  subtitle?: string;
  /** ナンバー。ナンバープレート風に出す */
  plate?: string;
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
        {(tag || overline) && (
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.textSecondary, letterSpacing: 0.5 }}>
            {tag && (
              <Text accessibilityElementsHidden importantForAccessibility="no" style={{ fontFamily: fonts.numMedium, color: colors.accentText, letterSpacing: 2.5 }}>
                {tag}
                {overline ? '  ' : ''}
              </Text>
            )}
            {overline}
          </Text>
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
        {plate && (
          <View accessibilityLabel={`ナンバー ${plate}`} style={styles.plate}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.plateText }}>{plate}</Text>
          </View>
        )}
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
  const textColor = tone === 'caution' ? colors.caution : colors.accentText;
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
      <Num size={13} style={{ color: textColor }}>{`${pct}%`}</Num>
    </View>
  );
}

/**
 * 「次にすること」。いま一番やるべきことを1つだけ、理由とボタン付きで出す。
 * 左端の色の帯で目立たせる（赤＝通常、琥珀色＝期限切れなどの注意）。
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
  const caution = tone === 'caution';
  const color = caution ? colors.caution : colors.accentText;
  const fill = caution ? colors.caution : colors.accent;
  const onFill = caution ? colors.onCaution : colors.white;
  return (
    <View style={[styles.card, { gap: spacing.sm, borderLeftWidth: 3, borderLeftColor: fill }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Ionicons name={caution ? 'warning-outline' : 'flag-outline'} size={14} color={color} />
        <Text accessibilityLabel="次にすること" style={{ fontFamily: fonts.numMedium, fontSize: 12, letterSpacing: 2.5, color }}>
          NEXT ACTION
        </Text>
      </View>
      <AppText variant="heading">{title}</AppText>
      <AppText style={{ fontSize: 13, lineHeight: 20, color: caution ? colors.caution : colors.textSecondary }}>{reason}</AppText>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.button, { marginTop: spacing.xs, backgroundColor: fill }, pressed && { opacity: 0.8 }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text style={{ color: onFill, fontFamily: fonts.semibold, fontSize: 16 }}>{cta}</Text>
          <Ionicons name="arrow-forward" size={18} color={onFill} />
        </View>
      </Pressable>
    </View>
  );
}

/**
 * タコメーター風の進み具合（左下＝前回の交換、右下＝交換時期）。最後の2割をレッドゾーンにし、
 * 今の位置に白い目盛りを立てる。中央（children）に残りの距離などを文字で置く。
 */
export function Tachometer({ value, label, children }: { value: number; label: string; children?: ReactNode }) {
  const pct = Math.min(1, Math.max(0, value));
  const W = 264;
  const H = 200;
  const cx = W / 2;
  const cy = 128;
  const r = 106;
  const start = 150; // 左下から時計回りに 240° 回す
  const sweep = 240;
  const at = (deg: number, radius: number) => {
    const t = (deg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t) };
  };
  const arc = (from: number, to: number) => {
    const a = at(from, r);
    const b = at(to, r);
    return `M${a.x} ${a.y} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
  };
  const now = start + sweep * pct;
  const ticks = Array.from({ length: 51 }, (_, i) => {
    const deg = start + (sweep * i) / 50;
    const major = i % 5 === 0;
    const a = at(deg, r - (major ? 22 : 15));
    const b = at(deg, r - 10);
    const stroke = i >= 40 ? colors.accent : major ? colors.textTertiary : colors.surfaceVariant;
    return <Line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={major ? 2 : 1} />;
  });
  const m0 = at(now, r + 3);
  const m1 = at(now, r - 20); // 4桁の距離（9,999km）でも中央の数字にかからない長さ
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ width: W, height: H, alignSelf: 'center' }}
    >
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="tach" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.accent} stopOpacity={0.25} />
            <Stop offset="1" stopColor={colors.accent} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Path d={arc(start, start + sweep)} stroke={colors.surfaceVariant} strokeWidth={5} strokeLinecap="round" fill="none" />
        {pct > 0 && <Path d={arc(start, now)} stroke="url(#tach)" strokeWidth={5} strokeLinecap="round" fill="none" />}
        {ticks}
        <Line x1={m0.x} y1={m0.y} x2={m1.x} y2={m1.y} stroke={colors.text} strokeWidth={3} strokeLinecap="round" />
        <Circle cx={m1.x} cy={m1.y} r={3} fill={colors.text} />
      </Svg>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 74, alignItems: 'center' }}>{children}</View>
      <View style={{ position: 'absolute', left: 18, right: 18, bottom: 0, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.textSecondary }}>前回交換</Text>
        <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.accentText }}>交換時期</Text>
      </View>
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
