/**
 * 運営スタッフ（HOLY・たにぐち自動車）。登録は SQL だけで行い（docs/setup.md 7章）、アプリは自分がスタッフかを読むだけ。
 * スタッフには設定に「運営メニュー」（お知らせ・スポンサー広告の管理）を出す。権限そのものは DB の RLS で守る
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './auth';
import { unwrap } from './db';
import { supabase } from './supabase';

export type StaffOrg = 'holy' | 'taniguchi';

export const STAFF_ORG_LABELS: Record<StaffOrg, string> = {
  holy: '株式会社HOLY',
  taniguchi: '株式会社たにぐち自動車',
};

/** スタッフなら所属、そうでなければ null */
export function useStaff() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['staff', userId],
    enabled: !!userId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const row = unwrap(await supabase.from('staff_members').select('org').eq('user_id', userId!).maybeSingle()) as { org: StaffOrg } | null;
      return row ? { org: row.org } : null;
    },
  });
}
