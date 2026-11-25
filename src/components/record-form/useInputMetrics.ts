import { useEffect, useRef } from 'react';
import { logInputSession } from '../../lib/data';

type Method = 'manual' | 'photo' | 'voice';

/**
 * 入力の計測（実証実験の KPI 用。社内資料/要確認一覧.md 50）。
 * 画面を開いてから保存・離脱までと、写真・音声で埋まった項目のうち、あとで直されたものの数を送る。
 * values は計測で比べる入力欄の今の値（表示している文字のまま）
 */
export function useInputMetrics<V extends Record<string, string>>({
  vehicleId,
  kind,
  isEdit,
  values,
  dirty,
}: {
  vehicleId: string;
  kind: string;
  isEdit: boolean;
  values: V;
  dirty: boolean;
}) {
  const latestValues = useRef(values);
  const state = useRef({
    openedAt: new Date(),
    method: 'manual' as Method,
    draftValues: {} as Partial<V>,
    warningsShown: 0,
    saved: false,
    touched: false,
  });

  const finish = (outcome: 'saved' | 'abandoned', recordRef: string | null) => {
    const m = state.current;
    const filled = Object.entries(m.draftValues) as [keyof V, string][];
    logInputSession({
      vehicleId,
      kind,
      mode: isEdit ? 'edit' : 'new',
      method: m.method,
      outcome,
      openedAt: m.openedAt,
      // 端末の時計が途中で戻っても、開いた時刻より前にはしない（DB の check で弾かれて計測が消えるため）
      finishedAt: new Date(Math.max(Date.now(), m.openedAt.getTime())),
      draftFields: filled.length,
      draftFieldsChanged: filled.filter(([field, v]) => latestValues.current[field] !== v).length,
      warningsShown: m.warningsShown,
      recordRef,
    });
  };

  // 保存せずに画面を離れたら「離脱」として送る。既存の記録を開いて見ただけ（何も変えずに戻った・削除した）は入力ではないので送らない。
  // ponytail: アプリを強制終了したときは送れない（離脱率は少なめに出る）。必要なら開いた時点で1行作り、終わりで更新する
  useEffect(
    () => () => {
      const m = state.current;
      if (m.saved || (isEdit && !m.touched)) return;
      finish('abandoned', null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    latestValues.current = values;
    if (dirty) state.current.touched = true;
  });

  return {
    /** 写真・音声で値を入れた */
    drafted: (via: Exclude<Method, 'manual'>, filled: Partial<V>) => {
      state.current.method = via;
      Object.assign(state.current.draftValues, filled);
    },
    /** 保存の前に確認を出した */
    warned: (count: number) => {
      state.current.warningsShown += count;
    },
    saved: (recordRef: string) => {
      state.current.saved = true;
      finish('saved', recordRef);
    },
  };
}
