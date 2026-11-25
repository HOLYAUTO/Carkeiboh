/** 入力の計測（実証実験の KPI 用。社内資料/要確認一覧.md 50） */
import Constants from 'expo-constants';
import { supabase } from '../supabase';

export interface InputSession {
  vehicleId: string;
  kind: string;
  mode: 'new' | 'edit';
  method: 'manual' | 'photo' | 'voice';
  outcome: 'saved' | 'abandoned';
  openedAt: Date;
  finishedAt: Date;
  draftFields: number;
  draftFieldsChanged: number;
  warningsShown: number;
  recordRef: string | null;
}

/** 記録画面1回分の計測を送る。送れなくても利用者の操作は止めない */
export function logInputSession(s: InputSession) {
  supabase
    .from('input_sessions')
    .insert({
      vehicle_id: s.vehicleId,
      kind: s.kind,
      mode: s.mode,
      method: s.method,
      outcome: s.outcome,
      opened_at: s.openedAt.toISOString(),
      finished_at: s.finishedAt.toISOString(),
      draft_fields: Math.min(s.draftFields, 20),
      draft_fields_changed: Math.min(s.draftFieldsChanged, s.draftFields, 20),
      warnings_shown: Math.min(s.warningsShown, 20),
      record_ref: s.recordRef,
      app_version: Constants.expoConfig?.version ?? null,
    })
    .then(({ error }) => {
      if (error) console.warn('入力の計測を送れませんでした', error.message);
    });
}
