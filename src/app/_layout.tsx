import { Saira_400Regular } from '@expo-google-fonts/saira/400Regular';
import { Saira_500Medium } from '@expo-google-fonts/saira/500Medium';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorView, Loading } from '../components/ui';
import { AuthProvider, useAuth } from '../lib/auth';
import { useBillingListener } from '../lib/billing';
import { usePlan, useVehicle } from '../lib/data';
import { useQuickActions } from '../lib/quick-actions';
// スタンドの出入りの見張り（TaskManager.defineTask）は起動の最初に定義する
import '../lib/fuel-geofence';
import { fonts, ThemeProvider, useColors, useTheme } from '../theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

// アプリを前面に戻したときに、古くなったデータ（お知らせ・記録など）を読み直す。
// React Native では react-query が画面の前面・背面を知らないため、AppState を伝える
focusManager.setEventListener((handleFocus) => {
  if (Platform.OS === 'web') return undefined;
  const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
  return () => sub.remove();
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export default function RootLayout() {
  // 日本語フォントは1ウェイトで約2MBあるため、使う太さ（400・500・600）だけ読み込む
  const [fontsLoaded] = useFonts({
    [fonts.regular]: require('@expo-google-fonts/m-plus-2/400Regular/MPLUS2_400Regular.ttf'),
    [fonts.medium]: require('@expo-google-fonts/m-plus-2/500Medium/MPLUS2_500Medium.ttf'),
    [fonts.semibold]: require('@expo-google-fonts/m-plus-2/600SemiBold/MPLUS2_600SemiBold.ttf'),
    [fonts.num]: Saira_400Regular,
    [fonts.numMedium]: Saira_500Medium,
  });

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <ThemedStatusBar />
            {fontsLoaded ? <RootNavigator /> : null}
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

function RootNavigator() {
  const colors = useColors();
  const { session, loading } = useAuth();
  const vehicle = useVehicle();
  const plan = usePlan();
  const signedIn = !!session;
  const hasVehicle = !!vehicle.data;
  // プランを読めなかったときは、残すクルマの選択を求めずに進める（ほかの画面でも上限は DB が守る）
  const checkingVehicle = signedIn && (vehicle.isPending || (hasVehicle && plan.isPending));
  // 複数台プランの期限が切れて上限を超えているときは、残すクルマを選ぶまでほかの画面に進めない
  const mustChooseVehicle = signedIn && hasVehicle && plan.data?.mustChooseVehicle === true;
  useBillingListener();
  useQuickActions();

  useEffect(() => {
    if (!loading && !checkingVehicle) SplashScreen.hideAsync().catch(() => {});
  }, [loading, checkingVehicle]);

  // ログアウトしたら前のアカウントの情報を残さない
  useEffect(() => {
    if (!signedIn) queryClient.clear();
  }, [signedIn]);

  if (loading || checkingVehicle) return <Loading />;
  // 通信エラーを「車両なし」と取り違えて初回設定に進ませない
  if (signedIn && vehicle.isError) {
    return <ErrorView message="読み込めませんでした。通信状態を確認してください。" onRetry={() => vehicle.refetch()} />;
  }

  return (
    <Stack
      screenOptions={({ navigation }) => ({
        headerTintColor: colors.accentText,
        headerTitleStyle: { fontFamily: fonts.semibold, color: colors.text },
        // 入力ミスに気づいたらすぐ1つ前に戻れるよう、左上に「戻る」を文字付きで出し、
        // iOS は画面のどこからでも右へスワイプして戻れるようにする（Android は端末の戻る操作）
        headerBackButtonDisplayMode: 'default',
        headerBackTitle: '戻る',
        fullScreenGestureEnabled: true,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        contentStyle: { backgroundColor: colors.background },
        // iOS 26 では、見出しを出さない画面（タブ）の上に重ねた画面で、標準の「戻る」を押しても
        // 何も起きないことがある（2026-11-07 報告。設定・お知らせ・記録などすべての画面）。
        // 標準の「戻る」を使わず、見出しのボタンから JS で1つ前に戻す。入力途中の確認（usePreventRemove）もこれで必ず出る
        ...(Platform.OS === 'ios'
          ? {
              unstable_headerLeftItems: ({ canGoBack }: { canGoBack?: boolean }) =>
                canGoBack
                  ? [
                      {
                        type: 'button' as const,
                        label: '‹ 戻る',
                        accessibilityLabel: '戻る',
                        labelStyle: { fontFamily: fonts.regular, fontSize: 17 },
                        tintColor: colors.accentText,
                        onPress: () => navigation.goBack(),
                      },
                    ]
                  : [],
            }
          : {}),
      })}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !hasVehicle}>
        <Stack.Screen name="onboarding" options={{ title: 'クルマの登録', headerBackVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={mustChooseVehicle}>
        <Stack.Screen name="keep-vehicle" options={{ title: '残すクルマを選ぶ', headerBackVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && hasVehicle && !mustChooseVehicle}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="records/new" options={{ title: '記録する' }} />
        <Stack.Screen name="records/index" options={{ title: '記録の一覧' }} />
        <Stack.Screen name="records/[id]" options={{ title: '記録の編集' }} />
        <Stack.Screen name="records/fuel-statement" options={{ title: '掛けカードの明細から登録' }} />
        <Stack.Screen name="records/receipts" options={{ title: 'レシートをまとめて取り込む' }} />
        <Stack.Screen name="settings/index" options={{ title: '設定' }} />
        <Stack.Screen name="settings/vehicle" options={{ title: '車両情報と周期' }} />
        <Stack.Screen name="settings/deadlines" options={{ title: '車検・点検・保険' }} />
        <Stack.Screen name="settings/odometer" options={{ title: '走行距離とメーター交換' }} />
        <Stack.Screen name="settings/appearance" options={{ title: '画面の色' }} />
        <Stack.Screen name="settings/tax-report" options={{ title: '確定申告用のまとめ' }} />
        <Stack.Screen name="settings/certificate" options={{ title: '車検証' }} />
        <Stack.Screen name="fuel-detect" options={{ title: '給油の記録のしかた' }} />
        <Stack.Screen name="settings/recurring" options={{ title: '決まった支出' }} />
        <Stack.Screen name="announcements/index" options={{ title: 'お知らせ' }} />
        <Stack.Screen name="announcements/[id]" options={{ title: 'お知らせ' }} />
        <Stack.Screen name="admin/announcements/index" options={{ title: 'お知らせの管理' }} />
        <Stack.Screen name="admin/announcements/[id]" options={{ title: 'お知らせの編集' }} />
        <Stack.Screen name="admin/sponsors/index" options={{ title: 'スポンサー広告の管理' }} />
        <Stack.Screen name="admin/sponsors/[id]" options={{ title: '広告の編集' }} />
        <Stack.Screen name="vehicles/index" options={{ title: 'クルマの切り替え・追加' }} />
        <Stack.Screen name="vehicles/new" options={{ title: 'クルマを追加' }} />
        <Stack.Screen name="vehicles/release" options={{ title: 'クルマを手放す' }} />
        <Stack.Screen name="share" options={{ title: 'アプリを紹介する' }} />
        <Stack.Screen name="shops/[id]" options={{ title: '整備工場' }} />
        {/* 下から出す画面は「キャンセル」で閉じるので、左上に「戻る」を出さない */}
        <Stack.Screen name="ledra/scan" options={{ title: 'QRコードを読み取る', presentation: 'modal', unstable_headerLeftItems: () => [] }} />
        <Stack.Screen name="ledra/consent" options={{ title: '整備工場との連携' }} />
      </Stack.Protected>
      {/* 残すクルマを選ぶ画面からも開けるよう、別にしておく（最初に開く画面にならないよう最後に置く） */}
      <Stack.Protected guard={signedIn && hasVehicle}>
        <Stack.Screen name="plan" options={{ title: '複数台プラン' }} />
      </Stack.Protected>
    </Stack>
  );
}
