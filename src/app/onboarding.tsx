import { useQueryClient } from '@tanstack/react-query';
import { AppText, Screen } from '../components/ui';
import { VehicleForm } from '../components/VehicleForm';
import { selectVehicle } from '../lib/data';
import { registerForPush } from '../lib/push';
import { useColors } from '../theme';

/** 初回設定。1分以内で終わる量に絞る（周期は既定値で始め、あとから設定で変えられる） */
export default function Onboarding() {
  const colors = useColors();
  const qc = useQueryClient();
  return (
    <Screen>
      <AppText style={{ color: colors.textSecondary }}>まずはクルマを1台登録します。あとから設定で変えられます。</AppText>
      <VehicleForm
        submitTitle="はじめる"
        onCreated={async (id) => {
          await registerForPush(true).catch(() => {});
          await selectVehicle(qc, id);
          await qc.invalidateQueries();
        }}
      />
    </Screen>
  );
}
