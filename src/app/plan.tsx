import { Ionicons } from '@expo/vector-icons';
import { PLAN_RESTORE_GRACE_DAYS, restoreFreeDaysLeft } from '@domain/billing.ts';
import { toJstDate } from '@domain/dates.ts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Linking, Platform, View } from 'react-native';
import { AppText, Badge, Button, Card, QueryFallback, Screen, SectionTitle } from '../components/ui';
import {
  buyPlus,
  buyRestoreFee,
  isJapanStorefront,
  isPurchaseCancelled,
  openSubscriptionSettings,
  restorePurchases,
  toBillingError,
  useBillingProducts,
} from '../lib/billing';
import { AppError, describeError } from '../lib/error-codes';
import { config } from '../lib/config';
import { restoreSuspendedVehicles, usePlan } from '../lib/data';
import { useAuth } from '../lib/auth';
import { fullDate } from '../lib/format';
import { spacing, useColors } from '../theme';

const BENEFITS = [
  '家族や仕事のクルマをまとめて登録（最大5台）',
  'オイル交換・車検・保険の通知を1台ずつ受け取る',
  '維持費をクルマごとに集計',
];

const STORE = Platform.OS === 'ios' ? 'Apple ID' : 'Google アカウント';
const STORE_NAME = Platform.OS === 'ios' ? 'App Store' : 'Google Play';
const STORE_SETTINGS = Platform.OS === 'ios' ? 'App Store のサブスクリプションの設定' : 'Google Play の定期購入の設定';

/**
 * 複数台プランの申し込み・状態・解約の案内と、休止中のクルマの表示の戻し。
 * 料金はストアに登録した値を表示する（仮に月額500円・事務手数料1,000円。docs/open-questions.md 30）。利用規約の下書き 第4条
 */
export default function Plan() {
  const colors = useColors();
  const qc = useQueryClient();
  const { session } = useAuth();
  const plan = usePlan();
  const products = useBillingProducts();
  const [busy, setBusy] = useState<'buy' | 'fee' | 'restore' | 'unsuspend' | null>(null);
  /** ストアの手続きが途中で終わったときの説明（エラーコード付き。お知らせはせず、画面に小さく出す） */
  const [cancelDetail, setCancelDetail] = useState<string | null>(null);

  if (!plan.isSuccess) return <QueryFallback queries={[plan]} />;
  const s = plan.data;
  const userId = session?.user.id;
  const plus = products.data?.plus ?? null;
  const fee = products.data?.restoreFee ?? null;
  const subscribed = s.subscription?.active === true;
  const price = plus?.displayPrice ?? config.plusPriceLabel;
  const storefront = products.data?.storefront ?? null;
  const storefrontIsJapan = isJapanStorefront(storefront);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setCancelDetail(null);
    try {
      await fn();
    } catch (e) {
      const err = toBillingError(e, storefront);
      if (isPurchaseCancelled(e)) {
        setCancelDetail(describeError(err));
        return;
      }
      Alert.alert('うまくいきませんでした', describeError(err));
    } finally {
      setBusy(null);
    }
  };

  const openLegal = (url: string) => {
    if (url) Linking.openURL(url);
    else Alert.alert('準備中です', '文面の公開後に表示されます。');
  };

  return (
    <Screen>
      <Card>
        <AppText variant="heading">複数台プラン</AppText>
        {s.plan === 'plus' ? (
          <Badge label={s.manualPlus && !subscribed ? 'ご利用中（運営による設定）' : 'ご利用中'} tone="accent" />
        ) : (
          <Badge label="無料プラン・1台まで" tone="neutral" />
        )}
        <AppText variant="caption">1台目は無料のまま。2台目からはこちらのプランでご利用いただけます。</AppText>
        <View style={{ gap: spacing.sm }}>
          {BENEFITS.map((b) => (
            <View key={b} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.accentText} style={{ marginTop: 1 }} />
              <AppText style={{ flex: 1 }}>{b}</AppText>
            </View>
          ))}
        </View>
        <AppText variant="label">{price ? `料金：${price}／月（自動更新）` : products.isPending ? '料金を読み込み中…' : '料金を読み込めませんでした'}</AppText>
        {!price && !products.isPending && (
          <>
            <AppText variant="caption">
              {products.isError
                ? describeError(products.error, 'IJ-BIL-001')
                : describeError(new AppError('IJ-BIL-002', 'ストアに複数台プランが見つかりませんでした。時間をおいて、もう一度読み込んでください。'))}
            </AppText>
            <Button title="もう一度読み込む" variant="plain" loading={products.isFetching} onPress={() => products.refetch()} />
          </>
        )}
        {storefrontIsJapan === false && (
          <AppText variant="caption">
            {describeError(
              new AppError(
                'IJ-BIL-003',
                `${STORE_NAME}の国・地域が日本になっていないため、料金が日本円で表示されず、申し込みもできないことがあります。`,
                `ストアの国・地域：${storefront}`,
              ),
            )}
          </AppText>
        )}
        {subscribed && s.subscription?.entitledUntil && (
          <AppText variant="caption">
            {s.subscription.autoRenew === false
              ? `自動更新は止まっています。${fullDate(toJstDate(new Date(s.subscription.entitledUntil)))}までご利用いただけます。`
              : `次の更新日：${fullDate(toJstDate(new Date(s.subscription.entitledUntil)))}`}
          </AppText>
        )}
      </Card>

      {!subscribed && !(s.plan === 'plus' && s.manualPlus) && (
        <Button
          title={price ? `申し込む（${price}／月）` : '申し込む'}
          disabled={!plus || !userId}
          loading={busy === 'buy'}
          onPress={() => run('buy', () => buyPlus(plus!, userId!))}
        />
      )}
      {subscribed && (
        <Button title="解約・お支払い方法の変更" variant="secondary" onPress={() => run('buy', openSubscriptionSettings)} />
      )}
      {cancelDetail && (
        <AppText variant="caption">
          {cancelDetail}
        </AppText>
      )}
      <Button
        title="購入を復元"
        variant="plain"
        loading={busy === 'restore'}
        onPress={() =>
          run('restore', async () => {
            const n = await restorePurchases(qc);
            Alert.alert(n > 0 ? '購入を復元しました' : '復元できる購入はありませんでした', n > 0 ? '' : `購入した${STORE}でログインしているか確かめてください。`);
          })
        }
      />

      {(s.suspendedRestorable > 0 || s.suspendedNeedsFee > 0) && (
        <>
          <SectionTitle>休止中のクルマ</SectionTitle>
          <Card>
            {s.suspendedRestorable > 0 && (
              <AppText>
                {s.suspendedRestorable}台が休止中です。複数台プランを申し込むと表示が戻ります。
                {s.restoreFreeUntil && `事務手数料なしで戻せるのは、あと${restoreFreeDaysLeft(s.restoreFreeUntil, new Date())}日です。`}
              </AppText>
            )}
            {s.suspendedNeedsFee > 0 && (
              <>
                <AppText>
                  休止から{PLAN_RESTORE_GRACE_DAYS}日を過ぎたクルマが{s.suspendedNeedsFee}台あります。表示を戻すには、複数台プランのご契約に加えて、復旧の事務手数料
                  {fee ? `（${fee.displayPrice}）` : ''}がかかります。整備工場との連携を再開し、止まっていた間の記録も取り込み直します。
                </AppText>
                {s.plan !== 'plus' ? (
                  <AppText variant="caption">先に複数台プランを申し込んでください。</AppText>
                ) : s.hasUnusedRestoreFee ? (
                  <Button
                    title="表示を戻す"
                    loading={busy === 'unsuspend'}
                    onPress={() =>
                      run('unsuspend', async () => {
                        await restoreSuspendedVehicles();
                        await Promise.all([qc.invalidateQueries({ queryKey: ['plan'] }), qc.invalidateQueries({ queryKey: ['vehicles'] })]);
                      })
                    }
                  />
                ) : (
                  <Button
                    title={fee ? `事務手数料を払って表示を戻す（${fee.displayPrice}）` : '事務手数料を払って表示を戻す'}
                    disabled={!fee || !userId}
                    loading={busy === 'fee'}
                    onPress={() => run('fee', () => buyRestoreFee(fee!, userId!))}
                  />
                )}
              </>
            )}
          </Card>
        </>
      )}

      <AppText variant="caption">
        お支払いは、購入の確定時に{STORE}に請求されます。期間が終わる24時間前までに解約しない限り、同じ料金で自動的に更新されます。解約は{STORE_SETTINGS}から行えます（アプリを削除しても解約にはなりません）。解約後は、使い続けるクルマを1台選んでいただき、ほかのクルマは休止になります（データは消えません）。
      </AppText>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.lg }}>
        <Button title="利用規約" variant="plain" onPress={() => openLegal(config.termsUrl)} />
        <Button title="プライバシーポリシー" variant="plain" onPress={() => openLegal(config.privacyUrl)} />
      </View>
    </Screen>
  );
}
