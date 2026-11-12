import { Ionicons } from '@expo/vector-icons';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { registerForPush, useAnnouncementNotificationTaps, useFuelVisitNotificationTaps } from '../../lib/push';
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
  useFuelVisitNotificationTaps();
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

/** 目に入りやすいよう、大きな丸いボタンにして少し浮かせるタブ */
const PRIMARY_TAB = 'record';
const PRIMARY_SIZE = 60;

/**
 * タブバー。等幅に並べ、選んでいるタブは上端の赤い線とアイコンの塗り・赤い色で示す。
 * 色だけで伝えないよう、ラベルも必ず出す。
 * 「記録する」だけはアクセント色の大きな丸いボタンにして、バーから少しはみ出させる。
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
        const primary = tab.name === PRIMARY_TAB;
        const onPress = () => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };
        if (primary) {
          return (
            <Pressable
              key={route.key}
              style={styles.item}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.title}
              onPress={onPress}
            >
              {({ pressed }) => (
                <>
                  <View style={[styles.primaryButton, pressed && styles.primaryButtonPressed]}>
                    <Ionicons name="add" size={36} color={colors.onAccent} />
                  </View>
                  <Text style={[styles.label, styles.primaryLabel]}>{tab.title}</Text>
                </>
              )}
            </Pressable>
          );
        }
        return (
          <Pressable
            key={route.key}
            style={[styles.item, focused && styles.itemActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.title}
            onPress={onPress}
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
    primaryButton: {
      width: PRIMARY_SIZE,
      height: PRIMARY_SIZE,
      borderRadius: PRIMARY_SIZE / 2,
      // バーの上へ半分近くはみ出させる（ラベルの位置は他のタブとそろえる）
      marginTop: -PRIMARY_SIZE / 2 - spacing.xs,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      borderWidth: 4,
      borderColor: colors.background,
      shadowColor: '#000000',
      shadowOpacity: 0.3,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 6,
    },
    primaryButtonPressed: { backgroundColor: colors.accentPressed },
    primaryLabel: { fontFamily: fonts.semibold, color: colors.accentText },
  }),
);
