/** 決まった支出（毎月・毎年）の読み書き */
import { useQuery } from '@tanstack/react-query';
import type { IsoDate } from '@domain/dates.ts';
import { deleteRow, saveRow, unwrap } from '../db';
import { supabase } from '../supabase';
import type { VehicleRow } from './rows';

export type RecurringCategory = 'maintenance' | 'shaken' | 'insurance' | 'car_tax' | 'parking_toll' | 'loan_lease' | 'other';

export interface RecurringExpenseRow {
  id: string;
  vehicle_id: string;
  category: RecurringCategory;
  /** 自動車税だけは null（車検証の内容から計算した税額を使う） */
  amount_yen: number | null;
  frequency: 'monthly' | 'yearly';
  month_of_year: number | null;
  day_of_month: number;
  starts_on: IsoDate;
  ends_on: IsoDate | null;
  note: string | null;
}

export interface RecurringBundle {
  rules: RecurringExpenseRow[];
  /** 記録した・飛ばした回（recurring_id → 日付） */
  handled: Map<string, Set<IsoDate>>;
}

export function useRecurringExpenses(vehicle: VehicleRow | undefined) {
  return useQuery({
    queryKey: ['recurring', vehicle?.user_id, vehicle?.id],
    enabled: !!vehicle,
    queryFn: async (): Promise<RecurringBundle> => {
      const rules = unwrap(
        await supabase.from('recurring_expenses').select('*').eq('vehicle_id', vehicle!.id).order('created_at'),
      ) as RecurringExpenseRow[];
      const handled = new Map<string, Set<IsoDate>>();
      if (rules.length > 0) {
        const occ = unwrap(
          await supabase.from('recurring_expense_occurrences').select('recurring_id, due_on').in('recurring_id', rules.map((r) => r.id)),
        ) as { recurring_id: string; due_on: IsoDate }[];
        for (const o of occ) {
          if (!handled.has(o.recurring_id)) handled.set(o.recurring_id, new Set());
          handled.get(o.recurring_id)!.add(o.due_on);
        }
      }
      return { rules, handled };
    },
  });
}

export async function saveRecurringExpense(input: Omit<RecurringExpenseRow, 'id'> & { id?: string }) {
  const { id, ...row } = input;
  await saveRow('recurring_expenses', row, id);
}

export const deleteRecurringExpense = (id: string) => deleteRow('recurring_expenses', id);

/** 1回分を記録する（支出を作る）か飛ばす */
export async function handleRecurringExpense(id: string, dueOn: IsoDate, record: boolean, amountYen: number | null) {
  unwrap(await supabase.rpc('handle_recurring_expense', { p_recurring_id: id, p_due_on: dueOn, p_record: record, p_amount_yen: amountYen }));
}
