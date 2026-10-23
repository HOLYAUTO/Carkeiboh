/** Expo Push での送信。https://docs.expo.dev/push-notifications/sending-notifications/ */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushResult {
  /** 送れた（Expo が受け付けた）トークン */
  accepted: string[];
  /** 端末からアプリが消えた等で、今後送っても届かないトークン */
  unregistered: string[];
}

const ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100;

export async function sendPush(messages: PushMessage[]): Promise<PushResult> {
  const result: PushResult = { accepted: [], unregistered: [] };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH).map((m) => ({
      ...m,
      sound: 'default',
      channelId: 'reminders',
      priority: 'high',
    }));
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Expo Push の送信に失敗しました（HTTP ${res.status}）`);
    const tickets = ((await res.json())?.data ?? []) as { status: string; details?: { error?: string } }[];
    tickets.forEach((t, j) => {
      const to = batch[j].to;
      if (t.status === 'ok') result.accepted.push(to);
      else if (t.details?.error === 'DeviceNotRegistered') result.unregistered.push(to);
      else console.warn('Expo Push のエラー', t);
    });
  }
  return result;
}
