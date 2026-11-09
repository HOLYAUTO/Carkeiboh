/**
 * レシートをまとめて取り込むときの、1枚ごとの扱い（そのまま登録できるか・登録済みと重なるか）。
 * 画面から切り離して試験できるよう、React Native に依存しない。
 */
import type { ExpenseCategory } from '@domain/costs.ts';
import type { IsoDate } from '@domain/dates.ts';
import type { RecordDraft } from '@shared/record-draft.ts';

export type BatchStatus =
  /** そのまま登録できる */
  | 'ready'
  /** 項目・日付・金額などが足りないので、開いて入力する */
  | 'needs_input'
  /** 読み取れなかった */
  | 'unreadable';

/** まとめて登録できる項目（オイル交換は走行距離が要るので開いて入力する） */
const BATCH_CATEGORIES: readonly string[] = ['fuel', 'maintenance', 'shaken', 'insurance', 'car_tax', 'parking_toll', 'loan_lease', 'other'];

export function batchStatus(draft: RecordDraft | null): BatchStatus {
  if (!draft || Object.keys(draft).length === 0) return 'unreadable';
  if (!draft.category || !BATCH_CATEGORIES.includes(draft.category)) return 'needs_input';
  if (!draft.date || draft.amountYen == null) return 'needs_input';
  return 'ready';
}

/** 登録済みの支出と同じか（同じ項目・同じ日・同じ金額） */
export function isDuplicate(draft: RecordDraft, existing: { category: ExpenseCategory; spent_on: IsoDate; amount_yen: number }[]): boolean {
  return existing.some((e) => e.category === draft.category && e.spent_on === draft.date && e.amount_yen === draft.amountYen);
}
