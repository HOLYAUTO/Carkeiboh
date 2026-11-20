import type { ReactNode } from 'react';
import { useStaff, type StaffOrg } from '../lib/staff';
import { Card, EmptyState, QueryFallback, Screen } from './ui';

/**
 * 運営メニューの画面の入れ物。スタッフでなければ中身を出さない
 * （書き込みの可否は DB の RLS が決める。これは画面の出し分けだけ）
 */
export function StaffOnly({ children }: { children: (org: StaffOrg) => ReactNode }) {
  const staff = useStaff();
  if (!staff.isSuccess) return <QueryFallback queries={[staff]} />;
  if (!staff.data) {
    return (
      <Screen>
        <Card>
          <EmptyState icon="lock-closed-outline" title="この画面は運営スタッフだけが使えます" />
        </Card>
      </Screen>
    );
  }
  return <>{children(staff.data.org)}</>;
}
