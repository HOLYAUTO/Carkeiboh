import { View } from 'react-native';
import { yen } from '../lib/format';
import { spacing } from '../theme';
import { AppText, Button, Divider, Num } from './ui';

/**
 * 「入力した数字」と「計算後の数字」だけを見せる。税の内訳や計算のしかたは見せない
 * （計算は supabase/functions/_shared/domain の fuel.ts・bookkeeping.ts）。
 */
export function ComputedAmount({
  input,
  totalYen,
  business,
  mismatch,
}: {
  /** 入力した数字（例：「32.15L × 172円/L（税抜）」「税抜 ¥10,000」） */
  input: string;
  /** 計算後の金額（税込） */
  totalYen: number;
  /** 仕事で使う割合を設定していれば、経費にする額 */
  business?: { percent: number; yen: number } | null;
  /** 自分で入れた金額と計算が違うとき（給油のレシートなど） */
  mismatch?: { enteredYen: number; onUseComputed: () => void } | null;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Row label="入力した数字" value={input} />
      <Divider />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText>計算後の金額（税込）</AppText>
        <Num size={20}>{yen(totalYen)}</Num>
      </View>
      {business && <Row label={`経費にする額（仕事 ${business.percent}%）`} value={yen(business.yen)} />}
      {mismatch && (
        <>
          <AppText variant="caption">入力した金額（{yen(mismatch.enteredYen)}）と計算が違います。レシートがあれば、レシートの合計を正としてください。</AppText>
          <Button title={`計算後の金額（${yen(totalYen)}）にする`} variant="secondary" onPress={mismatch.onUseComputed} />
        </>
      )}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
      <AppText variant="caption">{label}</AppText>
      <Num>{value}</Num>
    </View>
  );
}
