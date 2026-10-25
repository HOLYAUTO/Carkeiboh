import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AppText, Screen } from '../../components/ui';
import { VehicleForm } from '../../components/VehicleForm';
import { selectVehicle } from '../../lib/data';
import { colors } from '../../theme';

/** 2台目以降の登録。登録したらその車両に切り替えてホームに戻る */
export default function NewVehicle() {
  const qc = useQueryClient();
  return (
    <Screen>
      <AppText style={{ color: colors.textSecondary }}>追加したクルマは、ホームの車名から切り替えられます。記録・通知は1台ずつ分けて管理します。</AppText>
      <VehicleForm
        submitTitle="追加する"
        onCreated={async (id) => {
          await selectVehicle(qc, id);
          await qc.invalidateQueries();
          router.dismissTo('/');
        }}
      />
    </Screen>
  );
}
