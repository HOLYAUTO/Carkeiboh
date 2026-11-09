import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { AppText, Button, Card, Screen } from '../components/ui';
import { BACKGROUND_DETECTION_AVAILABLE, useFuelDetectMode, useSetFuelDetectMode, type FuelDetectMode } from '../lib/fuel-detect';
import { fonts, radius, spacing, useColors } from '../theme';

const OPTIONS: { mode: FuelDetectMode; title: string; body: string; note: string }[] = [
  {
    mode: 'on_open',
    title: 'アプリを開いたときに知らせる（おすすめ）',
    body: 'ガソリンスタンドでアプリを開くと、「給油を記録する」をいちばん上に出します。日付・スタンド名・油種を入れた状態で開きます。',
    note: 'アプリを開いたときだけ位置情報を使います。バッテリーはほとんど使いません。',
  },
  {
    mode: 'after_visit',
    title: 'スタンドを出たら通知する',
    body: 'ガソリンスタンドに数分いて出たら「給油しましたか？」と通知します。押すと入力した状態の記録画面が開きます。',
    note: '位置情報を「常に許可」にする必要があります。スマホの省電力の仕組みで見張るので、消耗は少なめですが、まったく使わないわけではありません。',
  },
  {
    mode: 'off',
    title: '使わない',
    body: '位置情報は使いません。給油は「記録する」から入れてください。',
    note: '',
  },
];

/**
 * 給油の記録のしかた（スタンドに来たら知らせるか）を選ぶ。最初に一度だけ開き、あとから設定で変えられる。
 * 現在地はサーバーに送らない（約5km四方の区画だけを送って、その中のスタンドの場所を受け取る）
 */
export default function FuelDetectChoice() {
  const colors = useColors();
  const current = useFuelDetectMode();
  const setMode = useSetFuelDetectMode();
  const [selected, setSelected] = useState<FuelDetectMode>(current.data ?? 'on_open');
  const [busy, setBusy] = useState(false);

  const done = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const decide = async () => {
    setBusy(true);
    try {
      if (selected === 'off') {
        await setMode('off');
        done();
        return;
      }
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        await setMode('off');
        Alert.alert('位置情報が使えません', 'スタンドに来たことを知らせるには、位置情報の許可が要ります。あとから「設定 → 給油の記録のしかた」で変えられます。', [
          { text: 'OK', onPress: done },
          ...(!permission.canAskAgain ? [{ text: '設定を開く', onPress: () => Linking.openSettings() }] : []),
        ]);
        return;
      }
      await setMode(selected);
      if (selected === 'after_visit' && !BACKGROUND_DETECTION_AVAILABLE) {
        Alert.alert(
          'スタンドを出たら通知する',
          'この知らせ方は、次のアプリの更新（ストア版）から使えるようになります。それまでは、スタンドでアプリを開いたときにお知らせします。',
          [{ text: 'OK', onPress: done }],
        );
        return;
      }
      done();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <AppText>ガソリンスタンドに来たら、給油の記録をお知らせできます。知らせ方を選んでください。あとから設定で変えられます。</AppText>
      {OPTIONS.map((o) => {
        const on = selected === o.mode;
        return (
          <Pressable
            key={o.mode}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => setSelected(o.mode)}
            style={{ borderRadius: radius.card, borderWidth: 2, borderColor: on ? colors.accent : 'transparent' }}
          >
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: on ? colors.accent : colors.textSecondary,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} />}
                </View>
                <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.text }}>{o.title}</Text>
              </View>
              <AppText>{o.body}</AppText>
              {o.note ? <AppText variant="caption">{o.note}</AppText> : null}
            </Card>
          </Pressable>
        );
      })}
      <Button title="これにする" loading={busy} onPress={decide} />
      <AppText variant="caption">
        現在地はサーバーに送りません（約5km四方の区画だけを送り、その中のスタンドの場所を受け取ります）。スタンドの場所：© OpenStreetMap contributors
      </AppText>
    </Screen>
  );
}
