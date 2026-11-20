import { addDays, addMonths, diffDays, formatDaysLeft, formatMonthDay, type IsoDate } from './dates.ts';
import type { ServiceForecast } from './service.ts';
import { formatDistance, type DistanceUnit } from './units.ts';

export type ReminderKind = 'oil' | 'filter' | 'shaken' | 'inspection' | 'insurance' | 'car_tax';

export const REMINDER_LABELS: Record<ReminderKind, string> = {
  oil: 'オイル交換',
  filter: 'オイルフィルター',
  shaken: '車検',
  inspection: '定期点検',
  insurance: '自動車保険',
  car_tax: '自動車税',
};

/** 項目ごとの通知オン・オフの既定値。自動車税だけ既定でオフ */
export const DEFAULT_REMINDER_SETTINGS: Record<ReminderKind, boolean> = {
  oil: true,
  filter: true,
  shaken: true,
  inspection: true,
  insurance: true,
  car_tax: false,
};

export type DeadlineKind = 'shaken' | 'inspection_legal' | 'inspection_voluntary' | 'insurance';

export const DEADLINE_LABELS: Record<DeadlineKind, string> = {
  shaken: '車検満了',
  inspection_legal: '法定点検',
  inspection_voluntary: '任意点検',
  insurance: '自動車保険の満期',
};

/**
 * ワンタッチ更新の選択肢（月数）。車検は自家用乗用が2年・事業用や貨物が1年、
 * 法定点検は12か月・24か月、保険は1年契約が多い。任意点検は半年ごとの人もいるので6か月から
 */
export const DEADLINE_RENEW_MONTHS: Record<DeadlineKind, number[]> = {
  shaken: [12, 24],
  inspection_legal: [12, 24],
  inspection_voluntary: [6, 12],
  insurance: [12, 24],
};

/** '1年後'・'6か月後' */
export function renewLabel(months: number): string {
  return months % 12 === 0 ? `${months / 12}年後` : `${months}か月後`;
}

/**
 * ワンタッチ更新の新しい期限。今の期限から months 後にする（満了日の前に車検を受けると、新しい満了日は前の満了日から数えるため）。
 * 期限が未登録、または months 後でもまだ今日より前（長く更新していなかった）なら、今日から数える
 */
export function renewedDueOn(current: IsoDate | null, months: number, today: IsoDate): IsoDate {
  if (current) {
    const next = addMonths(current, months);
    if (next > today) return next;
  }
  return addMonths(today, months);
}

/** 有効な期限だけを渡す（更新を登録した旧契約は superseded として除外される） */
export interface Deadline {
  id: string;
  kind: DeadlineKind;
  dueOn: IsoDate;
}

interface Stage {
  id: string;
  fireOn: IsoDate;
}

type StageRule = { id: string; months?: number; days?: number };

/** 5.4 の通知タイミング（目安日・期限日からさかのぼる） */
const SERVICE_STAGES: StageRule[] = [{ id: 'm1', months: 1 }, { id: 'w2', days: 14 }, { id: 'd0', days: 0 }];
const DEADLINE_STAGES: Record<DeadlineKind, StageRule[]> = {
  shaken: [{ id: 'm3', months: 3 }, { id: 'm2', months: 2 }, { id: 'm1', months: 1 }, { id: 'd7', days: 7 }, { id: 'd0', days: 0 }],
  inspection_legal: [{ id: 'm2', months: 2 }, { id: 'm1', months: 1 }, { id: 'd7', days: 7 }, { id: 'd0', days: 0 }],
  inspection_voluntary: [{ id: 'm2', months: 2 }, { id: 'm1', months: 1 }, { id: 'd7', days: 7 }, { id: 'd0', days: 0 }],
  insurance: [{ id: 'm2', months: 2 }, { id: 'm1', months: 1 }, { id: 'd14', days: 14 }, { id: 'd7', days: 7 }, { id: 'd1', days: 1 }],
};
/** 推定の残りがこの距離を切ったら通知 */
export const SERVICE_REMAINING_KM_ALERT = 500;
/** 【要確認】自動車税は「5月の納付時期」。通知日は仮に5月1日とする */
export const CAR_TAX_NOTIFY_MONTH_DAY = '05-01';

function buildStages(due: IsoDate, rules: StageRule[]): Stage[] {
  return rules.map((r) => ({
    id: r.id,
    fireOn: r.months ? addMonths(due, -r.months) : addDays(due, -(r.days ?? 0)),
  }));
}

/**
 * 今日送るべき段階。過ぎた段階のうち最も新しいものだけを返す
 * （期限を後から登録した場合などに、古い段階の通知をまとめて送らないため）。
 */
function currentStage(stages: Stage[], due: IsoDate, today: IsoDate, allowOverdue: boolean): Stage | null {
  if (today > due && !allowOverdue) return null;
  const passed = stages.filter((s) => s.fireOn <= today);
  return passed.at(-1) ?? null;
}

export interface PendingNotification {
  kind: ReminderKind;
  /** 送信済みの記録に使うキー。1件の通知が複数の段階をまとめることがある */
  keys: string[];
  title: string;
  body: string;
}

export interface ServiceReminderInput {
  /** 前回交換の記録ID。交換し直すとキーが変わり、通知が新しい周期でやり直しになる */
  baselineId: string;
  forecast: ServiceForecast;
}

export interface ReminderInput {
  vehicleName: string;
  today: IsoDate;
  settings: Record<ReminderKind, boolean>;
  oil: ServiceReminderInput | null;
  filter: ServiceReminderInput | null;
  deadlines: Deadline[];
  sentKeys: ReadonlySet<string>;
  /** 通知の文の距離の単位（既定は km） */
  distanceUnit?: DistanceUnit;
}

function serviceNotification(
  kind: 'oil' | 'filter',
  input: ServiceReminderInput,
  today: IsoDate,
  sentKeys: ReadonlySet<string>,
  unit: DistanceUnit,
): PendingNotification | null {
  const { forecast, baselineId } = input;
  const keys: string[] = [];

  if (forecast.remainingKm != null && forecast.remainingKm <= SERVICE_REMAINING_KM_ALERT) {
    const key = `${kind}:${baselineId}:km${SERVICE_REMAINING_KM_ALERT}`;
    if (!sentKeys.has(key)) keys.push(key);
  }
  if (forecast.dueDate) {
    // 予測日は日々動くので、目安日を過ぎてしまった場合も当日分は1回送る
    const stage = currentStage(buildStages(forecast.dueDate, SERVICE_STAGES), forecast.dueDate, today, true);
    if (stage) {
      const key = `${kind}:${baselineId}:${stage.id}`;
      if (!sentKeys.has(key)) keys.push(key);
    }
  }
  if (keys.length === 0) return null;

  const label = REMINDER_LABELS[kind];
  const parts: string[] = [];
  if (forecast.remainingKm != null) {
    parts.push(
      forecast.remainingKm > 0
        ? `推定であと${formatDistance(forecast.remainingKm, unit)}`
        : `推定で${formatDistance(-forecast.remainingKm, unit)}超過`,
    );
  }
  if (forecast.dueDate && forecast.remainingDays != null) {
    parts.push(`目安日 ${formatMonthDay(forecast.dueDate)}（${formatDaysLeft(forecast.remainingDays)}）`);
  }
  const overdue =
    (forecast.remainingKm != null && forecast.remainingKm <= 0) ||
    (forecast.remainingDays != null && forecast.remainingDays < 0);
  return {
    kind,
    keys,
    title: overdue ? `${label}の目安を過ぎています` : `${label}の目安が近づいています`,
    body: parts.join('・'),
  };
}

function deadlineKind(kind: DeadlineKind): ReminderKind {
  return kind === 'shaken' ? 'shaken' : kind === 'insurance' ? 'insurance' : 'inspection';
}

function deadlineNotification(
  deadline: Deadline,
  today: IsoDate,
  sentKeys: ReadonlySet<string>,
): PendingNotification | null {
  const stage = currentStage(buildStages(deadline.dueOn, DEADLINE_STAGES[deadline.kind]), deadline.dueOn, today, false);
  if (!stage) return null;
  const key = `${deadline.kind}:${deadline.id}:${stage.id}`;
  if (sentKeys.has(key)) return null;
  const label = DEADLINE_LABELS[deadline.kind];
  const days = diffDays(today, deadline.dueOn);
  return {
    kind: deadlineKind(deadline.kind),
    keys: [key],
    title: days === 0 ? `今日は${label}日です` : `${label}まで${formatDaysLeft(days)}`,
    body: `${label}日は ${formatMonthDay(deadline.dueOn)} です。`,
  };
}

/** 今日送る通知の一覧（日本時間9:00の定期実行から呼ぶ） */
export function pendingNotifications(input: ReminderInput): PendingNotification[] {
  const { today, settings, sentKeys } = input;
  const result: PendingNotification[] = [];

  if (settings.oil && input.oil) {
    const n = serviceNotification('oil', input.oil, today, sentKeys, input.distanceUnit ?? 'km');
    if (n) result.push(n);
  }
  if (settings.filter && input.filter) {
    const n = serviceNotification('filter', input.filter, today, sentKeys, input.distanceUnit ?? 'km');
    if (n) result.push(n);
  }
  for (const d of input.deadlines) {
    if (!settings[deadlineKind(d.kind)]) continue;
    const n = deadlineNotification(d, today, sentKeys);
    if (n) result.push(n);
  }
  if (settings.car_tax && today.slice(5) === CAR_TAX_NOTIFY_MONTH_DAY) {
    const key = `car_tax:${today.slice(0, 4)}`;
    if (!sentKeys.has(key)) {
      result.push({
        kind: 'car_tax',
        keys: [key],
        title: '自動車税の納付時期です',
        body: '5月は自動車税の納付時期です。納付書をご確認ください。',
      });
    }
  }
  return result.map((n) => ({ ...n, title: `${input.vehicleName}：${n.title}` }));
}

export type AlertLevel = 'overdue' | 'soon' | 'normal';

export interface UpcomingItem {
  kind: ReminderKind;
  label: string;
  dueOn: IsoDate;
  remainingDays: number;
  level: AlertLevel;
  /** 予測に基づく日付なら true（「推定」と表示する） */
  estimated: boolean;
}

/** これ以内なら「もうすぐ」扱い */
export const SOON_DAYS = 30;

/**
 * ホームの「もうすぐの期限」。通知が届かなくても困らないよう、通知のオン・オフに関係なく出す。
 * 満了を過ぎた車検などは、更新を登録する（期限が superseded になる）まで overdue として残り続ける。
 */
export function upcomingItems(
  input: Pick<ReminderInput, 'today' | 'oil' | 'filter' | 'deadlines'>,
  horizonDays = 90,
): UpcomingItem[] {
  const { today } = input;
  const items: UpcomingItem[] = [];
  const push = (kind: ReminderKind, label: string, dueOn: IsoDate, estimated: boolean) => {
    const remainingDays = diffDays(today, dueOn);
    if (remainingDays > horizonDays) return;
    const level: AlertLevel = remainingDays < 0 ? 'overdue' : remainingDays <= SOON_DAYS ? 'soon' : 'normal';
    items.push({ kind, label, dueOn, remainingDays, level, estimated });
  };
  if (input.oil?.forecast.dueDate) push('oil', 'オイル交換の目安', input.oil.forecast.dueDate, true);
  if (input.filter?.forecast.dueDate) push('filter', 'オイルフィルター交換の目安', input.filter.forecast.dueDate, true);
  for (const d of input.deadlines) push(deadlineKind(d.kind), DEADLINE_LABELS[d.kind], d.dueOn, false);
  return items.sort((a, b) => a.remainingDays - b.remainingDays);
}
