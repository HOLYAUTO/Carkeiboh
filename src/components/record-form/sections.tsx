/** 記録フォームのうち、項目によって出し分ける入力欄のまとまり */
import { router } from 'expo-router';
import type { WearKind } from '../../lib/data';
import { AppText, Button, Field, Segmented, ToggleRow } from '../ui';

const PAYMENT_OPTIONS: { value: 'now' | 'on_account'; label: string }[] = [
  { value: 'now', label: 'その場で払った' },
  { value: 'on_account', label: 'かけ（掛けカード）' },
];

/** 支払い方法。かけ（後払い）は税抜の金額・単価を入れてもらい、消費税をアプリで足す */
export function PaymentFields({ onAccount, onChange, showStatementLink }: { onAccount: boolean; onChange: (v: boolean) => void; showStatementLink: boolean }) {
  return (
    <>
      <AppText variant="label">支払い</AppText>
      <Segmented options={PAYMENT_OPTIONS} value={onAccount ? 'on_account' : 'now'} onChange={(v) => onChange(v === 'on_account')} />
      {onAccount && (
        <>
          <AppText variant="caption">掛けカードの請求書の税抜の単価を入れてください。消費税などはアプリで足します。</AppText>
          {showStatementLink && <Button title="月の明細からまとめて登録する" variant="plain" onPress={() => router.push('/records/fuel-statement')} />}
        </>
      )}
    </>
  );
}

/** タイヤ・ブレーキの入力欄の文言。残りの目安は、分からない人が空欄で進めるよう任意にする */
const WEAR_FORM: Record<WearKind, { replaced: string; remaining: string; hint: string }> = {
  tire: {
    replaced: 'タイヤを交換した',
    remaining: '溝の深さ（いちばん浅いところ・任意）',
    hint: '分からなければ空欄で大丈夫です。新品は8mm前後、1.6mm でスリップサインが出ます。',
  },
  brake: {
    replaced: 'ブレーキパッドを交換した',
    remaining: 'パッドの厚さ（いちばん薄いところ・任意）',
    hint: '整備工場で言われた数字を入れてください。分からなければ空欄で大丈夫です。',
  },
};

export function WearFields({
  kind,
  replaced,
  onReplaced,
  remaining,
  onRemaining,
  remainingValid,
}: {
  kind: WearKind;
  replaced: boolean;
  onReplaced: (v: boolean) => void;
  remaining: string;
  onRemaining: (v: string) => void;
  remainingValid: boolean;
}) {
  const form = WEAR_FORM[kind];
  return (
    <>
      <ToggleRow title={form.replaced} description="点検・確認だけなら、オフのまま記録します。" value={replaced} onChange={onReplaced} />
      <Field
        label={form.remaining}
        value={remaining}
        onChangeText={onRemaining}
        keyboardType="decimal-pad"
        suffix="mm"
        hint={remainingValid ? form.hint : '数字で入力してください（例：3.5）'}
      />
    </>
  );
}

/** 自動車税・重量税を計算できないときの案内 */
export function TaxSpecNotice({ kind, specComplete, specLabel }: { kind: 'car_tax' | 'shaken'; specComplete: boolean; specLabel: string }) {
  const tax = kind === 'car_tax' ? '自動車税' : '重量税';
  return (
    <>
      <AppText variant="caption">
        {specComplete
          ? `このクルマ（${specLabel}）の${tax}は自動で計算できません。${kind === 'car_tax' ? '納付書' : '請求書'}の金額を入れてください。`
          : `車検証の内容を入れると、${tax}を自動で計算します。`}
      </AppText>
      {!specComplete && <Button title="車検証の内容を入れる" variant="secondary" onPress={() => router.push('/settings/certificate')} />}
    </>
  );
}
