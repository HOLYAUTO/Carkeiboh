// 事前通知の配信（毎日 日本時間 9:00、pg_cron から呼ぶ）。
// 予測は日々変わるため、端末の予約通知に頼らず、毎朝サーバーで計算して送る。
import { toJstDate, isIsoDate } from '../_shared/domain/dates.ts';
import { vehicleNotifications } from '../_shared/domain/vehicle.ts';
import {
  toVehicleData,
  type DeadlineRow,
  type MeterReplacementRow,
  type OdometerPointRow,
  type OilChangeRow,
  type VehicleRow,
} from '../_shared/db-mapping.ts';
import { sendPush } from '../_shared/expo-push.ts';
import { handle, HttpError, json, readJson, requireCronSecret, requirePost } from '../_shared/http.ts';
import { adminClient, type SupabaseClient } from '../_shared/supabase.ts';

interface Body {
  /** 試験用：日付を指定して実行する（テスト端末で各タイミングの通知を確かめるため） */
  today?: string;
  /** 試験用：特定の利用者だけに送る */
  userId?: string;
  /** 試験用：送らずに内容だけ返す */
  dryRun?: boolean;
}

const PAGE = 200;

async function rowsFor<T>(admin: SupabaseClient, table: string, columns: string, vehicleIds: string[]): Promise<T[]> {
  const { data, error } = await admin.from(table).select(columns).in('vehicle_id', vehicleIds);
  if (error) throw error;
  return (data ?? []) as T[];
}

function groupBy<T extends { vehicle_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) map.set(r.vehicle_id, [...(map.get(r.vehicle_id) ?? []), r]);
  return map;
}

Deno.serve(
  handle(async (req) => {
    requirePost(req);
    requireCronSecret(req);
    const body = await readJson<Body>(req).catch(() => ({}) as Body);
    if (body.today && !isIsoDate(body.today)) throw new HttpError(400, 'invalid_today');
    const today = body.today ?? toJstDate(new Date());
    const admin = adminClient();

    const summary = { today, vehicles: 0, notifications: 0, sent: 0, removedTokens: 0, preview: [] as unknown[] };

    for (let from = 0; ; from += PAGE) {
      // 手放したクルマ・複数台プランの解約で休止中のクルマには送らない
      let q = admin.from('vehicles_in_service').select('*').order('id').range(from, from + PAGE - 1);
      if (body.userId) q = q.eq('user_id', body.userId);
      const { data: vehicles, error } = await q;
      if (error) throw error;
      if (!vehicles || vehicles.length === 0) break;

      const ids = vehicles.map((v) => v.id as string);
      const userIds = [...new Set(vehicles.map((v) => v.user_id as string))];
      const [oil, points, meters, deadlines, logs, tokens] = await Promise.all([
        rowsFor<OilChangeRow>(admin, 'oil_changes', '*', ids),
        rowsFor<OdometerPointRow>(admin, 'odometer_points', 'vehicle_id, date, odo_km, source', ids),
        rowsFor<MeterReplacementRow>(admin, 'meter_replacements', '*', ids),
        rowsFor<DeadlineRow>(admin, 'deadlines', '*', ids),
        rowsFor<{ vehicle_id: string; key: string }>(admin, 'notification_log', 'vehicle_id, key', ids),
        admin.from('push_tokens').select('token, user_id').in('user_id', userIds),
      ]);
      if (tokens.error) throw tokens.error;
      const oilBy = groupBy(oil);
      const pointsBy = groupBy(points);
      const metersBy = groupBy(meters);
      const deadlinesBy = groupBy(deadlines);
      const logsBy = groupBy(logs);
      const tokensBy = new Map<string, string[]>();
      for (const t of tokens.data ?? []) tokensBy.set(t.user_id, [...(tokensBy.get(t.user_id) ?? []), t.token]);

      for (const v of vehicles as VehicleRow[]) {
        summary.vehicles++;
        const userTokens = tokensBy.get(v.user_id) ?? [];
        // 通知を許可していない利用者には送らない（記録もしないので、許可した後に今の段階が届く）
        if (userTokens.length === 0 && !body.dryRun) continue;

        const data = toVehicleData(v, {
          oilChanges: oilBy.get(v.id) ?? [],
          points: pointsBy.get(v.id) ?? [],
          meterReplacements: metersBy.get(v.id) ?? [],
          deadlines: deadlinesBy.get(v.id) ?? [],
        });
        const sent = new Set((logsBy.get(v.id) ?? []).map((l) => l.key));
        const pending = vehicleNotifications(data, today, sent);
        summary.notifications += pending.length;
        if (body.dryRun) {
          summary.preview.push(...pending.map((n) => ({ vehicleId: v.id, ...n })));
          continue;
        }

        for (const n of pending) {
          // 先に送信済みとして記録し、同時実行や再実行で二重に送らないようにする
          const { data: claimed, error: claimError } = await admin
            .from('notification_log')
            .upsert(
              n.keys.map((key) => ({ vehicle_id: v.id, user_id: v.user_id, key, title: n.title, body: n.body })),
              { onConflict: 'vehicle_id,key', ignoreDuplicates: true },
            )
            .select('id');
          if (claimError) throw claimError;
          if (!claimed || claimed.length === 0) continue;

          try {
            const result = await sendPush(
              userTokens.map((to) => ({ to, title: n.title, body: n.body, data: { kind: n.kind, vehicleId: v.id } })),
            );
            summary.sent += result.accepted.length;
            if (result.unregistered.length > 0) {
              await admin.from('push_tokens').delete().in('token', result.unregistered);
              summary.removedTokens += result.unregistered.length;
            }
          } catch (e) {
            // 送れなかった分は記録を戻し、次の回に送り直す
            await admin.from('notification_log').delete().in('id', claimed.map((c) => c.id));
            console.error(e);
          }
        }
      }
      if (vehicles.length < PAGE) break;
    }

    console.log('notify-dispatch', { ...summary, preview: summary.preview.length });
    return json(summary);
  }),
);
