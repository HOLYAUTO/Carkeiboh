import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushStatus = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function getPushStatus(): Promise<PushStatus> {
  if (!Device.isDevice) return 'unsupported';
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * 通知の許可を求め、端末のトークンをサーバーに登録する。
 * 通知の予定はサーバーが毎朝計算して送るので、端末側で予約はしない。
 */
export async function registerForPush(ask: boolean): Promise<PushStatus> {
  if (!Device.isDevice) return 'unsupported';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: '期限のお知らせ',
      // AndroidImportance は types ファイルからの再エクスポートで、eslint-plugin-import が追えない
      // eslint-disable-next-line import/namespace
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    // 運営からのお知らせ・たにぐち自動車の最新情報（announce-dispatch が送る）。端末の設定で期限のお知らせと分けて止められる
    await Notifications.setNotificationChannelAsync('announcements', {
      name: 'お知らせ',
      // eslint-disable-next-line import/namespace
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' && ask) status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return status;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  if (error) console.warn('通知の登録に失敗しました', error.message);
  return status;
}

function isAnnouncement(data: unknown): data is { kind: 'announcement'; announcementId: string } {
  const d = data as { kind?: unknown; announcementId?: unknown } | undefined;
  return d?.kind === 'announcement' && typeof d.announcementId === 'string';
}

/**
 * お知らせの通知を押したら、そのお知らせを開く（アプリが閉じていたときも、起動後に開く）。
 * アプリを開いている間に届いたときも、ホームと一覧にすぐ出るよう読み直す
 */
export function useAnnouncementNotificationTaps() {
  const qc = useQueryClient();
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      if (isAnnouncement(notification.request.content.data)) qc.invalidateQueries({ queryKey: ['announcements'] });
    });
    return () => sub.remove();
  }, [qc]);

  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const data = response.notification.request.content.data;
    if (!isAnnouncement(data)) return;
    // 同じ通知でもう一度開かないよう、扱ったら消す
    Notifications.clearLastNotificationResponse();
    qc.invalidateQueries({ queryKey: ['announcements'] });
    router.push({ pathname: '/announcements/[id]', params: { id: data.announcementId } });
  }, [response, qc]);
}
