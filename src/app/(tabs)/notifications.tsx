import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ANNOUNCEMENT_LABELS } from '@domain/announcements.ts';
import { REMINDER_LABELS, type ReminderKind } from '@domain/reminders.ts';
import { AppText, Badge, Button, Card, Divider, ErrorView, IconButton, ListRow, Notice, Screen, ScreenHeader, SectionTitle, Skeleton, ToggleRow } from '../../components/ui';
import { setShopNewsOptIn, useAnnouncements } from '../../lib/announcements';
import { updateVehicle, useInvalidate, useVehicleBundle, vehicleUnit, type VehicleRow } from '../../lib/data';
import { daysLeft, fullDate, jstDateTime, km } from '../../lib/format';
import { getPushStatus, registerForPush, type PushStatus } from '../../lib/push';
import { fonts, MIN_TAP, spacing, useColors } from '../../theme';

const ITEMS: { kind: ReminderKind; column: keyof VehicleRow; description: string }[] = [
  { kind: 'oil', column: 'notify_oil', description: '推定の残りが500km、目安日の1か月前・2週間前・当日（距離と期間の早い方）' },
  { kind: 'filter', column: 'notify_filter', description: 'フィルターの周期で、オイル交換と同じタイミング' },
  { kind: 'shaken', column: 'notify_shaken', description: '満了の3か月前・2か月前・1か月前・7日前・当日' },
  { kind: 'inspection', column: 'notify_inspection', description: '予定の2か月前・1か月前・7日前・当日（法定・任意）' },
  { kind: 'insurance', column: 'notify_insurance', description: '満期の2か月前・1か月前・14日前・7日前・前日' },
  { kind: 'car_tax', column: 'notify_car_tax', description: '5月の納付時期（5月1日）' },
];

export default function Notifications() {
  const colors = useColors();
  const { bundle } = useVehicleBundle();
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  const announcements = useAnnouncements();
  const [push, setPush] = useState<PushStatus | null>(null);
  // 保存中の「最新情報を受け取る」。サーバーの値が更新されるまでこちらを表示する
  const [pendingShopNews, setPendingShopNews] = useState<boolean | null>(null);
  // 保存中の切り替え。サーバーの値が更新されるまでこちらを表示する
  // （サーバーの値だけで表示すると、押したスイッチが一度戻ってから切り替わる）
  const [pending, setPending] = useState<Partial<Record<keyof VehicleRow, boolean>>>({});

  useFocusEffect(
    useCallback(() => {
      getPushStatus().then(setPush);
    }, []),
  );

  const header = <ScreenHeader tag="NOTICE" title="通知" right={<IconButton icon="settings-outline" label="設定" onPress={() => router.push('/settings')} />} />;
  if (bundle.isPending) {
    return (
      <Screen header={header}>
        <Skeleton height={200} />
        <Skeleton height={160} />
      </Screen>
    );
  }
  if (bundle.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => bundle.refetch()} />;
  const { vehicle, state, notifications } = bundle.data;
  const alerts = state.upcoming.filter((u) => u.level !== 'normal');
  // 1件の通知が複数の段階をまとめて記録されることがあるので、同じ内容は1つにする
  const recent = notifications.filter(
    (n, i, all) => all.findIndex((m) => m.title === n.title && m.body === n.body && m.sent_at.slice(0, 16) === n.sent_at.slice(0, 16)) === i,
  );

  const toggle = async (column: keyof VehicleRow, value: boolean) => {
    setPending((p) => ({ ...p, [column]: value }));
    try {
      await updateVehicle(vehicle.id, { [column]: value });
      await invalidate();
    } catch (e) {
      Alert.alert('変更できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      // 続けて押されていたら、あとの切り替えの表示を残す
      setPending(({ [column]: current, ...rest }) => (current === value ? rest : { ...rest, [column]: current }));
    }
  };

  const toggleShopNews = async (value: boolean) => {
    setPendingShopNews(value);
    try {
      await setShopNewsOptIn(value);
      if (value) setPush(await registerForPush(true));
      await qc.invalidateQueries({ queryKey: ['announcementPrefs'] });
    } catch (e) {
      Alert.alert('変更できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setPendingShopNews(null);
    }
  };

  const enablePush = async () => {
    const status = await registerForPush(true);
    setPush(status);
    if (status === 'denied') {
      Alert.alert('通知がオフになっています', '端末の設定アプリから、イジログの通知を許可してください。', [
        { text: '閉じる', style: 'cancel' },
        { text: '設定を開く', onPress: () => Linking.openSettings() },
      ]);
    }
  };

  return (
    <Screen header={header}>
      {push && push !== 'granted' && push !== 'unsupported' && (
        <Card>
          <AppText variant="heading">通知を受け取る</AppText>
          <AppText variant="caption">期限が近づいたら、日本時間の朝9時にお知らせします。</AppText>
          <Button title="通知を許可する" onPress={enablePush} />
        </Card>
      )}

      <SectionTitle>直近の警告</SectionTitle>
      {alerts.length === 0 ? (
        <Card>
          <AppText variant="caption">30日以内の期限や、過ぎている期限はありません。</AppText>
        </Card>
      ) : (
        alerts.map((a) => (
          <Notice key={`${a.kind}-${a.dueOn}`} title={`${a.label}：${daysLeft(a.remainingDays)}`}>
            {fullDate(a.dueOn)}
            {a.estimated ? '（推定）' : ''}
          </Notice>
        ))
      )}

      <SectionTitle>項目ごとの通知</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: spacing.sm }}>
        {ITEMS.map((item, i) => (
          <View key={item.kind}>
            {i > 0 && <Divider />}
            <ToggleRow
              title={REMINDER_LABELS[item.kind]}
              description={item.description}
              value={pending[item.column] ?? (vehicle[item.column] as boolean)}
              onChange={(v) => toggle(item.column, v)}
            />
          </View>
        ))}
      </Card>
      <AppText variant="caption" style={{ marginHorizontal: spacing.xs }}>
        通知は日本時間9:00に届きます。通知が届かなくても、期限はホームに必ず表示します。
      </AppText>

      <SectionTitle action={{ label: '一覧を見る', onPress: () => router.push('/announcements') }}>お知らせ</SectionTitle>
      {announcements.visible && announcements.visible.length > 0 && (
        <Card style={{ gap: 0, paddingVertical: spacing.sm }}>
          {announcements.visible.slice(0, 3).map((a, i) => {
            const isNew = announcements.unread?.some((u) => u.id === a.id) ?? false;
            return (
              <View key={a.id}>
                {i > 0 && <Divider />}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${isNew ? '未読。' : ''}${ANNOUNCEMENT_LABELS[a.category]}。${a.title}`}
                  onPress={() => router.push({ pathname: '/announcements/[id]', params: { id: a.id } })}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: MIN_TAP + 8, paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1 })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: spacing.xs }}>
                      {isNew && <Badge label="NEW" />}
                      <AppText variant="caption">{ANNOUNCEMENT_LABELS[a.category]}・{jstDateTime(a.published_at).slice(0, 10)}</AppText>
                    </View>
                    <AppText numberOfLines={2} style={{ fontFamily: fonts.semibold }}>{a.title}</AppText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}
      <Card style={{ gap: 0, paddingVertical: spacing.sm }}>
        <ToggleRow
          title="アップデート・修正のお知らせ"
          description="アプリの修正や新しい機能をホームでお知らせします。大切なお知らせは通知でも届きます。"
          value
          disabled
        />
        <Divider />
        <ToggleRow
          title="たにぐち自動車の最新情報"
          description="新しいサービス・キャンペーン・営業日のお知らせなどを、ホームと通知でお届けします。"
          value={pendingShopNews ?? announcements.prefs?.shopNewsOptIn === true}
          onChange={toggleShopNews}
          disabled={!announcements.prefs}
        />
      </Card>

      <SectionTitle>オイル交換の周期</SectionTitle>
      <Card style={{ paddingVertical: 4 }}>
        <ListRow
          title="オイル"
          detail={[vehicle.oil_interval_km && km(vehicle.oil_interval_km, vehicleUnit(vehicle)), vehicle.oil_interval_months && `${vehicle.oil_interval_months}か月`].filter(Boolean).join('・')}
          onPress={() => router.push('/settings/vehicle')}
        />
        <Divider />
        <ListRow
          title="オイルフィルター"
          detail={[vehicle.filter_interval_km && km(vehicle.filter_interval_km, vehicleUnit(vehicle)), vehicle.filter_interval_months && `${vehicle.filter_interval_months}か月`].filter(Boolean).join('・')}
          onPress={() => router.push('/settings/vehicle')}
        />
      </Card>

      {recent.length > 0 && (
        <>
          <SectionTitle>最近届いた通知</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            {recent.slice(0, 10).map((n, i) => (
              <View key={n.id} style={{ gap: 2 }}>
                {i > 0 && <Divider />}
                <AppText>{n.title}</AppText>
                <AppText variant="caption">{n.body}</AppText>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
