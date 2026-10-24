import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorView, Loading } from '../components/ui';
import { AuthProvider, useAuth } from '../lib/auth';
import { useVehicle } from '../lib/data';
import { colors, fonts } from '../theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export default function RootLayout() {
  // 日本語フォントは1ウェイト約5MBあるため、使う太さだけ読み込む
  const [fontsLoaded] = useFonts({
    [fonts.regular]: require('@expo-google-fonts/noto-sans-jp/400Regular/NotoSansJP_400Regular.ttf'),
    [fonts.medium]: require('@expo-google-fonts/noto-sans-jp/500Medium/NotoSansJP_500Medium.ttf'),
    [fonts.semibold]: require('@expo-google-fonts/noto-sans-jp/600SemiBold/NotoSansJP_600SemiBold.ttf'),
    [fonts.mono]: GeistMono_400Regular,
    [fonts.monoMedium]: GeistMono_500Medium,
  });

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="dark" />
          {fontsLoaded ? <RootNavigator /> : null}
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, loading } = useAuth();
  const vehicle = useVehicle();
  const signedIn = !!session;
  const checkingVehicle = signedIn && vehicle.isPending;
  const hasVehicle = !!vehicle.data;

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
      screenOptions={{
        headerTintColor: colors.accent,
        headerTitleStyle: { fontFamily: fonts.semibold, color: colors.text },
        // 入力ミスに気づいたらすぐ1つ前に戻れるよう、左上に「戻る」を文字付きで出し、
        // iOS は画面のどこからでも右へスワイプして戻れるようにする（Android は端末の戻る操作）
        headerBackButtonDisplayMode: 'default',
        headerBackTitle: '戻る',
        fullScreenGestureEnabled: true,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !hasVehicle}>
        <Stack.Screen name="onboarding" options={{ title: 'クルマの登録', headerBackVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && hasVehicle}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="records/new" options={{ title: '記録する' }} />
        <Stack.Screen name="records/index" options={{ title: '記録の一覧' }} />
        <Stack.Screen name="records/[id]" options={{ title: '記録の編集' }} />
        <Stack.Screen name="settings/index" options={{ title: '設定' }} />
        <Stack.Screen name="settings/vehicle" options={{ title: '車両情報と周期' }} />
        <Stack.Screen name="settings/deadlines" options={{ title: '車検・点検・保険' }} />
        <Stack.Screen name="settings/odometer" options={{ title: '走行距離とメーター交換' }} />
        <Stack.Screen name="vehicles/index" options={{ title: 'クルマの切り替え・追加' }} />
        <Stack.Screen name="vehicles/new" options={{ title: 'クルマを追加' }} />
        <Stack.Screen name="plan" options={{ title: '複数台プラン' }} />
        <Stack.Screen name="shops/[id]" options={{ title: '整備工場' }} />
        <Stack.Screen name="ledra/scan" options={{ title: 'QRコードを読み取る', presentation: 'modal' }} />
        <Stack.Screen name="ledra/consent" options={{ title: '整備工場との連携' }} />
      </Stack.Protected>
    </Stack>
  );
}
