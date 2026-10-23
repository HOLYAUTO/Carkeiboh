import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { Pressable } from 'react-native';
import { registerForPush } from '../../lib/push';
import { colors, fonts, MIN_TAP } from '../../theme';

function SettingsButton() {
  return (
    <Link href="/settings" asChild>
      <Pressable accessibilityRole="button" accessibilityLabel="設定" style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="settings-outline" size={22} color={colors.accent} />
      </Pressable>
    </Link>
  );
}

export default function TabsLayout() {
  // 許可済みなら、起動のたびに端末のトークンを登録し直す（機種変更・再インストールに備える）
  useEffect(() => {
    registerForPush(false).catch(() => {});
  }, []);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
        headerTitleStyle: { fontFamily: fonts.semibold, color: colors.text },
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.background },
        headerRight: () => <SettingsButton />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'ホーム', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="costs"
        options={{ title: '維持費', tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="record"
        options={{ title: '記録する', tabBarIcon: ({ color, size }) => <Ionicons name="add-circle-outline" color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="notifications"
        options={{ title: '通知', tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" color={color as string} size={size} /> }}
      />
    </Tabs>
  );
}
