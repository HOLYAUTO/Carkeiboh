import { Ionicons } from '@expo/vector-icons';
import { PLAN_RESTORE_GRACE_DAYS } from '@domain/billing.ts';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { AppText, Button, ListCard, ListRow, Notice, QueryFallback, Screen, SectionTitle } from '../components/ui';
import { keepVehicle, selectVehicle, useVehicles } from '../lib/data';
import { useColors } from '../theme';

/**
 * 複数台プランの期限が切れて、無料プランの上限（1台）を超えているときに出す。
 * 残す1台を選ぶまで、ほかの画面には進めない（ルートのレイアウトで切り替える）。利用規約の下書き 第4条
 */
export default function KeepVehicle() {
  const colors = useColors();
  const qc = useQueryClient();
  const vehicles = useVehicles();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!vehicles.isSuccess) return <QueryFallback queries={[vehicles]} />;
  const list = vehicles.data;
  const chosen = list.find((v) => v.id === selected) ?? null;

  const confirm = () => {
    if (!chosen) return;
    const others = list.length - 1;
    Alert.alert(
      `「${chosen.name}」を残しますか`,
      `ほかの${others}台は休止になります。データは消えませんが、記録・お知らせ・整備工場との連携は止まります。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '残す',
          onPress: async () => {
            setBusy(true);
            try {
              await keepVehicle(chosen.id);
              await selectVehicle(qc, chosen.id);
              await Promise.all([qc.invalidateQueries({ queryKey: ['vehicles'] }), qc.invalidateQueries({ queryKey: ['plan'] })]);
            } catch (e) {
              Alert.alert('選べませんでした', e instanceof Error && e.message.includes('vehicle_not_found') ? 'このクルマは見つかりません。' : '時間をおいてお試しください。');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <Notice title="複数台プランの期限が切れました">
        無料プランでは1台だけ使えます。使い続けるクルマを1台選んでください。選ばなかったクルマのデータは消えずに休止になり、複数台プランを再び申し込むと表示が戻ります。休止から{PLAN_RESTORE_GRACE_DAYS}日を過ぎると、表示を戻すのに復旧の事務手数料がかかります。
      </Notice>

      <SectionTitle>残すクルマ</SectionTitle>
      <ListCard>
        {list.map((v) => (
          <ListRow
            key={v.id}
            title={v.name}
            detail={v.plate_number ?? undefined}
            right={
              <Ionicons
                name={v.id === selected ? 'radio-button-on' : 'radio-button-off'}
                size={22}
                color={v.id === selected ? colors.accentText : colors.textTertiary}
                accessibilityLabel={v.id === selected ? '選択中' : '未選択'}
              />
            }
            onPress={() => setSelected(v.id)}
          />
        ))}
      </ListCard>

      <Button title="このクルマを残す" onPress={confirm} disabled={!chosen} loading={busy} />
      <AppText variant="caption" style={{ textAlign: 'center' }}>
        すべてのクルマを使い続けるには、複数台プランを申し込んでください。
      </AppText>
      <Button title="複数台プランを見る" variant="secondary" onPress={() => router.push('/plan')} />
    </Screen>
  );
}
