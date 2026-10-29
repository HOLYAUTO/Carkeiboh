import { Ionicons } from '@expo/vector-icons';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { registerForPush, useAnnouncementNotificationTaps } from '../../lib/push';
import { fonts, MIN_TAP, spacing, themedStyles, useColors } from '../../theme';

/** タブの定義（01 4章：ホーム／維持費／記録する／通知。整備工場は送客のために追加。「記録する」を真ん中に置く） */
const TABS = [
  { name: 'index', title: 'ホーム', icon: 'home', outline: 'home-outline' },
  { name: 'costs', title: '維持費', icon: 'wallet', outline: 'wallet-outline' },
  { name: 'record', title: '記録する', icon: 'add-circle', outline: 'add-circle-outline' },
  { name: 'shops', title: '整備工場', icon: 'construct', outline: 'construct-outline' },
  { name: 'notifications', title: '通知', icon: 'notifications', outline: 'notifications-outline' },
] as const;

export default function TabsLayout() {
  const colors = useColors();
  useAnnouncementNotificationTaps();
  // 許可済みなら、起動のたびに端末のトークンを登録し直す（機種変更・再インストールに備える）
  useEffect(() => {
    registerForPush(false).catch(() => {});
  }, []);

  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title }} />
      ))}
    </Tabs>
  );
}

/**
 * タブバー。等幅に並べ、選んでいるタブは上端の赤い線とアイコンの塗り・赤い色で示す。
 * 色だけで伝えないよう、ラベルも必ず出す。
 */
function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.xs }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        const tab = TABS.find((t) => t.name === route.name);
        if (!tab) return null;
        const focused = state.index === index;
        return (
          <Pressable
            key={route.key}
            style={[styles.item, focused && styles.itemActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.title}
            onPress={() => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigateToTab(route.key);
            }}
          >
            <Ionicons name={focused ? tab.icon : tab.outline} size={24} color={focused ? colors.accentText : colors.textSecondary} />
            <Text style={[styles.label, focused && styles.labelActive]}>{tab.title}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = themedStyles((colors) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: spacing.xs,
    },
    item: {
      flex: 1,
      minHeight: MIN_TAP + 8,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      paddingTop: spacing.sm,
      borderTopWidth: 2,
      borderTopColor: 'transparent',
      marginTop: -1,
    },
    itemActive: { borderTopColor: colors.accent },
    label: { fontFamily: fonts.medium, fontSize: 11, color: colors.textSecondary },
    labelActive: { fontFamily: fonts.semibold, color: colors.text },
  }),
);
