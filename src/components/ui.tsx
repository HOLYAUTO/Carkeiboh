import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
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
import { SafeAreaView } from 'react-native-safe-area-context';
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

/** 金額・距離・日付用の等幅数字 */
export function Num({ size = 15, style, ...rest }: TextProps & { size?: number }) {
  return (
    <Text
      {...rest}
      style={[{ color: colors.text, fontFamily: size >= 20 ? fonts.monoMedium : fonts.mono, fontSize: size, fontVariant: ['tabular-nums'] }, style]}
    />
  );
}

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.screenContent, { flex: 1 }]}>{children}</View>
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

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <AppText variant="label" style={{ marginTop: spacing.lg, marginBottom: spacing.sm, marginLeft: spacing.xs }}>
      {children}
    </AppText>
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

export function Badge({ label, tone = 'accent' }: { label: string; tone?: 'accent' | 'caution' | 'neutral' }) {
  const fg = tone === 'accent' ? colors.accent : tone === 'caution' ? colors.caution : colors.textSecondary;
  const bg = tone === 'accent' ? colors.accentSoft : tone === 'caution' ? colors.cautionBackground : colors.track;
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontFamily: fonts.medium, fontSize: 11 }}>{label}</Text>
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
            <Text style={{ fontFamily: selected ? fonts.semibold : fonts.regular, fontSize: 14, color: colors.text }}>{o.label}</Text>
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
          style={[styles.input, input.keyboardType === 'number-pad' && { fontFamily: fonts.mono }]}
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
  screenContent: { padding: spacing.lg, paddingBottom: spacing.xl * 2, gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.lg, gap: spacing.md, ...cardShadow },
  button: { minHeight: MIN_TAP + 4, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  notice: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.cautionBackground, borderRadius: radius.control, padding: spacing.md },
  segmented: { flexDirection: 'row', backgroundColor: colors.track, borderRadius: radius.control, padding: 2 },
  segment: { flex: 1, minHeight: MIN_TAP - 4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control - 2 },
  segmentSelected: { backgroundColor: colors.card, ...cardShadow },
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
