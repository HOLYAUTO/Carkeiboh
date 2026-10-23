import type { IsoDate } from './dates.ts';
import { normalizeReadings, effectiveOdo, type MeterReplacement, type OdoReading } from './odo.ts';
import {
  DEFAULT_REMINDER_SETTINGS,
  pendingNotifications,
  upcomingItems,
  type Deadline,
  type PendingNotification,
  type ReminderKind,
  type ServiceReminderInput,
  type UpcomingItem,
} from './reminders.ts';
import { forecastService, latestService, type ServiceInterval } from './service.ts';

/**
 * アプリとサーバー（通知の定期実行）で同じ計算をするための、車両1台分の入力。
 * DB の行をこの形に詰め替えてから渡す。
 */
export interface VehicleData {
  name: string;
  annualKmEstimate: number;
  oilInterval: ServiceInterval;
  filterInterval: ServiceInterval;
  settings: Record<ReminderKind, boolean>;
  oilChanges: { id: string; date: IsoDate; odoKm: number; oilChanged: boolean; filterChanged: boolean }[];
  /** オイル交換以外の ODO の点（手入力・初回設定・支出に付けた ODO） */
  otherReadings: OdoReading[];
  meterReplacements: MeterReplacement[];
  deadlines: Deadline[];
}

export interface VehicleState {
  readings: OdoReading[];
  oil: ServiceReminderInput | null;
  filter: ServiceReminderInput | null;
  upcoming: UpcomingItem[];
}

export function buildVehicleState(data: VehicleData, today: IsoDate): VehicleState {
  const readings = normalizeReadings(
    [...data.otherReadings, ...data.oilChanges.map((o) => ({ date: o.date, odoKm: o.odoKm }))],
    data.meterReplacements,
  );
  const services = data.oilChanges.map((o) => ({
    ...o,
    odoKm: effectiveOdo({ date: o.date, odoKm: o.odoKm }, data.meterReplacements),
  }));

  const serviceInput = (part: 'oil' | 'filter', interval: ServiceInterval): ServiceReminderInput | null => {
    const last = latestService(services, part);
    if (!last) return null;
    return {
      baselineId: last.id,
      forecast: forecastService({
        baseline: { date: last.date, odoKm: last.odoKm },
        interval,
        readings,
        annualKmEstimate: data.annualKmEstimate,
        today,
      }),
    };
  };

  const oil = serviceInput('oil', data.oilInterval);
  const filter = serviceInput('filter', data.filterInterval);
  return {
    readings,
    oil,
    filter,
    upcoming: upcomingItems({ today, oil, filter, deadlines: data.deadlines }),
  };
}

export function vehicleNotifications(
  data: VehicleData,
  today: IsoDate,
  sentKeys: ReadonlySet<string>,
): PendingNotification[] {
  const state = buildVehicleState(data, today);
  return pendingNotifications({
    vehicleName: data.name,
    today,
    settings: { ...DEFAULT_REMINDER_SETTINGS, ...data.settings },
    oil: state.oil,
    filter: state.filter,
    deadlines: data.deadlines,
    sentKeys,
  });
}
