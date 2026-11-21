/** 「記録する」で選ぶ項目と、その呼び方 */
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from '@domain/costs.ts';
import type { ExpenseRow, OdometerReadingRow, OilChangeRow, WearCheckRow, WearKind } from './data';

/** オイル交換・支出の各項目に加え、タイヤ・ブレーキの点検と走行距離だけの記録もできる */
export type RecordKind = ExpenseCategory | WearKind | 'odometer';

/** 編集する記録 */
export type EditTarget =
  | { type: 'oil'; row: OilChangeRow; expense: ExpenseRow | null }
  | { type: 'expense'; row: ExpenseRow }
  | { type: 'odometer'; row: OdometerReadingRow }
  | { type: 'wear'; row: WearCheckRow };

const WEAR_LABELS: Record<WearKind, string> = { tire: 'タイヤ', brake: 'ブレーキ' };

export function isWearKind(kind: string): kind is WearKind {
  return kind === 'tire' || kind === 'brake';
}

export function wearTitle(w: Pick<WearCheckRow, 'kind' | 'replaced'>): string {
  if (w.kind === 'tire') return w.replaced ? 'タイヤ交換' : 'タイヤの点検';
  return w.replaced ? 'ブレーキパッド交換' : 'ブレーキの点検';
}

export function kindLabel(kind: RecordKind): string {
  if (kind === 'odometer') return '走行距離だけ';
  return isWearKind(kind) ? WEAR_LABELS[kind] : EXPENSE_CATEGORY_LABELS[kind];
}
