-- 定期実行の登録例（環境ごとに値が違うためマイグレーションには入れない）。
-- 事前に Vault に project_url と cron_secret を登録し、拡張 pg_cron と pg_net を有効にしておく。
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<CRON_SECRET と同じ値>', 'cron_secret');

-- Ledra からのオイル交換記録の取得：1時間ごと（2026-10-23 確定）
select cron.schedule(
  'ledra-sync-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/ledra-sync',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- 事前通知：毎日 日本時間 9:00（= UTC 0:00）（2026-10-23 確定）
select cron.schedule(
  'notify-dispatch-daily',
  '0 0 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notify-dispatch',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
