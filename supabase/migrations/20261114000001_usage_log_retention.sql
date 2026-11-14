-- 利用記録の保存期間（プライバシーポリシー 第11項）：広告の表示・タップ、整備工場の画面の操作、入力の使いやすさの計測は2年で消す。
-- 消すのは毎日の定期実行（supabase/cron.example.sql の usage-log-retention-daily）。広告主・掲載店へ報告済みの合計の数は変わらない
create or replace function public.purge_old_usage_logs(p_keep interval default interval '2 years')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before timestamptz := now() - p_keep;
  v_ads bigint;
  v_shops bigint;
  v_inputs bigint;
begin
  delete from public.sponsor_ad_events where created_at < v_before;
  get diagnostics v_ads = row_count;
  delete from public.shop_referrals where created_at < v_before;
  get diagnostics v_shops = row_count;
  delete from public.input_sessions where finished_at < v_before;
  get diagnostics v_inputs = row_count;
  return jsonb_build_object('sponsor_ad_events', v_ads, 'shop_referrals', v_shops, 'input_sessions', v_inputs);
end;
$$;

-- 利用者からは呼べない（定期実行と運営だけ）
revoke all on function public.purge_old_usage_logs(interval) from public, anon, authenticated;
