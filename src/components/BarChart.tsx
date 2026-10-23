import { View } from 'react-native';
import { colors, spacing } from '../theme';
import { yen } from '../lib/format';
import { AppText, Num } from './ui';

/** 月ごとの棒グラフ。棒の高さに加えて金額も文字で出す（読み上げにも対応） */
export function MonthlyBarChart({ data, currentMonth }: { data: { month: string; totalYen: number }[]; currentMonth: string }) {
  const max = Math.max(1, ...data.map((d) => d.totalYen));
  const visible = data.slice(-12);
  return (
    <View
      accessible
      accessibilityLabel={visible.map((d) => `${Number(d.month.slice(5))}月 ${yen(d.totalYen)}`).join('、')}
      style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, height: 150 }}
    >
      {visible.map((d) => {
        const current = d.month === currentMonth;
        return (
          <View key={d.month} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            {visible.length <= 6 && d.totalYen > 0 && (
              <Num size={10} style={{ color: colors.textSecondary }}>
                {d.totalYen >= 10000 ? `${Math.round(d.totalYen / 1000)}k` : d.totalYen.toLocaleString('ja-JP')}
              </Num>
            )}
            <View
              style={{
                width: '70%',
                height: Math.max(2, (d.totalYen / max) * 100),
                borderRadius: 4,
                backgroundColor: current ? colors.accent : 'rgba(0,113,227,0.35)',
              }}
            />
            <AppText variant="caption" style={current ? { color: colors.text } : undefined}>
              {Number(d.month.slice(5))}月
            </AppText>
          </View>
        );
      })}
    </View>
  );
}
