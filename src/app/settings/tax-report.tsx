import { useMemo, useState } from 'react';
import { Alert, Share, View } from 'react-native';
import { annualBookkeeping, bookkeepingCsv, defaultBookkeepingYear } from '@domain/bookkeeping.ts';
import { EXPENSE_CATEGORY_LABELS } from '@domain/costs.ts';
import { AppText, Button, Card, Divider, ErrorView, Field, Loading, Num, Screen, SectionTitle, Segmented } from '../../components/ui';
import { bookkeepingExpenses, updateVehicle, useInvalidate, useVehicleBundle, type VehicleBundle } from '../../lib/data';
import { parseInteger, yen } from '../../lib/format';
import { spacing } from '../../theme';

/**
 * 確定申告用のまとめ。1年（1月〜12月）の維持費を勘定科目ごとにまとめ、仕事で使う割合を掛けた「経費にする額」を出す。
 * 画面には計算後の数字だけを出し、明細は表（CSV）にして送る（会計ソフト・表計算ソフト・税理士へ）。
 */
export default function TaxReport() {
  const { bundle } = useVehicleBundle();
  if (bundle.isPending) return <Loading />;
  if (bundle.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;
  return <Report bundle={bundle.data} />;
}

function Report({ bundle }: { bundle: VehicleBundle }) {
  const invalidate = useInvalidate();
  const { vehicle, expenses, today } = bundle;
  const thisYear = Number(today.slice(0, 4));
  // 記録のある年のうち新しい3年（申告の時期は前の年から）
  const years = useMemo(() => {
    const set = new Set<number>([defaultBookkeepingYear(today), thisYear]);
    for (const e of expenses) set.add(Number(e.spent_on.slice(0, 4)));
    return [...set].filter((y) => y <= thisYear).sort((a, b) => b - a).slice(0, 3);
  }, [expenses, today, thisYear]);
  const [year, setYear] = useState(defaultBookkeepingYear(today));
  const savedPercent = vehicle.business_use_percent ?? null;
  const [percentText, setPercentText] = useState(savedPercent != null ? String(savedPercent) : '');
  const [busy, setBusy] = useState(false);

  const percentN = parseInteger(percentText);
  const percentValid = percentN == null || (Number.isFinite(percentN) && percentN >= 0 && percentN <= 100);
  const percent = percentValid ? percentN : savedPercent;
  const report = useMemo(() => annualBookkeeping(bookkeepingExpenses(expenses), year, percent), [expenses, year, percent]);

  const savePercent = async () => {
    if (!percentValid) return;
    setBusy(true);
    try {
      await updateVehicle(vehicle.id, { business_use_percent: percentN });
      await invalidate();
    } catch (e) {
      Alert.alert('保存できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const title = `イジログ 維持費の明細 ${year}年（${vehicle.name}）`;
    const csv = bookkeepingCsv(report, (c) => EXPENSE_CATEGORY_LABELS[c], title);
    try {
      await Share.share({ title, message: csv });
    } catch (e) {
      Alert.alert('送れませんでした', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <Segmented options={years.map((y) => ({ value: String(y), label: `${y}年` }))} value={String(year)} onChange={(v) => setYear(Number(v))} />
      <Card>
        <AppText variant="label">経費にする額</AppText>
        <Num size={36}>{yen(report.businessYen)}</Num>
        <AppText variant="caption">
          {`${year}年1月〜12月に記録した ${report.lines.length}件（${vehicle.name}）。支払った合計 ${yen(report.totalYen)}`}
        </AppText>
        {report.byAccount.length > 0 && <Divider />}
        {report.byAccount.map((t) => (
          <View key={t.account} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText>{t.account}</AppText>
            <Num>{yen(t.businessYen)}</Num>
          </View>
        ))}
        {report.businessConsumptionTaxYen > 0 && (
          <>
            <Divider />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText variant="caption">うち消費税</AppText>
              <Num>{yen(report.businessConsumptionTaxYen)}</Num>
            </View>
          </>
        )}
        {report.onAccountCount > 0 && (
          <AppText variant="caption">{`かけ（あとで請求）で記録した分が ${report.onAccountCount}件・${yen(report.onAccountYen)} あります。年内に支払っていない分も、使った日の年の経費になります。`}</AppText>
        )}
      </Card>

      <SectionTitle>仕事で使う割合</SectionTitle>
      <Card>
        <Field
          label={`${vehicle.name}を仕事で使う割合（任意）`}
          value={percentText}
          onChangeText={setPercentText}
          keyboardType="number-pad"
          suffix="%"
          placeholder="例：60"
          hint={percentValid ? '空欄なら全額を経費にします。仕事と私用の両方で使うなら、走った距離や日数のうち仕事の割合を入れてください。' : '0〜100 の数字で入れてください'}
        />
        <Button
          title="割合を保存する"
          variant="secondary"
          disabled={!percentValid || percentN === savedPercent}
          loading={busy}
          onPress={savePercent}
        />
      </Card>

      <Button title="明細を表（CSV）で送る" disabled={report.lines.length === 0} onPress={share} />
      <AppText variant="caption" style={{ marginTop: spacing.xs }}>
        会計ソフト・表計算ソフトに貼り付けたり、税理士に送ったりできます。金額はアプリで計算した目安です。申告の前に、レシート・請求書と合っているか確かめてください。
      </AppText>
    </Screen>
  );
}
