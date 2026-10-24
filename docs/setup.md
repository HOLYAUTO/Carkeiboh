# セットアップと配布の手順

アカウント（Apple Developer、Google Play Console、Supabase、Expo）は株式会社HOLY 名義で作り、
将来たにぐち自動車へ移管できるよう、すべてカーケイボー専用にします（Ledra と共有しない）。

## 1. Supabase（カーケイボー専用の組織・プロジェクト）

1. 専用の組織とプロジェクトを作る（リージョンは東京）
2. マイグレーションを適用する
   ```sh
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
3. 認証の設定（Authentication → Providers）
   - **Email**：確認コード（OTP）でログインする。メールテンプレート「Magic Link」の本文に `{{ .Token }}` を入れ、6桁のコードが届くようにする
   - **Apple**：Services ID・Key を登録。iPhone は端末のサインイン（ID トークン）、Android はブラウザ経由
   - **Google**：OAuth クライアントを登録
   - Redirect URLs に `carkeibo://auth/callback` を追加
4. Edge Functions をデプロイし、secrets を設定する
   ```sh
   npx supabase functions deploy
   npx supabase secrets set LEDRA_API_BASE_URL=... LEDRA_API_KEY=... CRON_SECRET=... EXPO_ACCESS_TOKEN=... ANTHROPIC_API_KEY=...
   ```
   - `ANTHROPIC_API_KEY` は「写真で入力」（`read-record-photo`）で使う。カーケイボー専用の Claude API キーを発行する
5. 定期実行を登録する：拡張 `pg_cron`・`pg_net` を有効にし、Vault に `project_url`・`cron_secret` を登録してから `supabase/cron.example.sql` を実行
   - Ledra 取得：毎時（`ledra-sync`）
   - 事前通知：毎日 UTC 0:00 = 日本時間 9:00（`notify-dispatch`）

## 2. Expo / EAS（カーケイボー専用のプロジェクト）

1. `npx eas-cli@latest init` でプロジェクトを作り、`app.json` の `extra.eas.projectId` に入る ID を確認する
2. アプリID は `app.carkeibo`（iOS のバンドルID・Android のパッケージ名。公開後は変更できない）
3. 環境変数（EAS の Environment variables）に `.env.example` の `EXPO_PUBLIC_*` を設定する
4. プッシュ通知の資格情報：iOS は APNs キー、Android は FCM v1 のサービスアカウントキーを EAS に登録する
5. 開発ビルド：`npx eas-cli@latest build --profile development`
   - 音声入力（`expo-speech-recognition`）・位置情報・写真の読み取りはネイティブモジュールを使うため、Expo Go では動かない（音声入力は「使えません」と案内する）。開発ビルドで確かめる

## 3. 限定配布（TestFlight・Google Play 内部テスト）

```sh
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --profile production --platform ios      # TestFlight
npx eas-cli@latest submit --profile production --platform android  # 内部テスト（track: internal）
```

- ストア上の販売元は HOLY と表示されるため、アプリ名・説明文でたにぐち自動車のアプリであることが分かるようにする（`app.json` の `description`、ストアの説明文）
- 利用規約・プライバシーポリシー（名義はたにぐち自動車、HOLY は開発・管理の委託先）の URL を、アプリ（`EXPO_PUBLIC_TERMS_URL` / `EXPO_PUBLIC_PRIVACY_URL`）とストアの両方に設定する

## 4. 通知の試験（完成の条件「5.4 の通知がタイミングどおりにテスト端末へ届く」）

`notify-dispatch` は日付を指定して実行できます（`CRON_SECRET` が必要）。

```sh
# 送らずに内容だけ確認
curl -X POST "$SUPABASE_URL/functions/v1/notify-dispatch" \
  -H "x-cron-secret: $CRON_SECRET" -H 'content-type: application/json' \
  -d '{"today":"2026-11-01","userId":"<テスト利用者のID>","dryRun":true}'

# 実際にテスト端末へ送る
curl -X POST "$SUPABASE_URL/functions/v1/notify-dispatch" \
  -H "x-cron-secret: $CRON_SECRET" -H 'content-type: application/json' \
  -d '{"today":"2026-11-01","userId":"<テスト利用者のID>"}'
```

同じ段階の通知は `notification_log` に記録され、二度は送られません。やり直す場合はその利用者の `notification_log` を削除してください。

## 5. 整備工場の掲載（送客）

掲載料の契約ができた整備工場を、Supabase の SQL エディタ（service_role）で登録します。利用者からは掲載中の店舗だけが見えます。

```sql
insert into public.shops (name, address, phone, latitude, longitude, business_hours, services, is_published, listing_starts_on, listing_ends_on, display_priority)
values ('株式会社たにぐち自動車', '（住所）', '0000-00-0000', 35.0000, 135.0000, '9:00〜18:00（日曜定休）',
        array['オイル交換', '車検', '一般整備'], true, '2026-11-01', null, 100);
```

- 緯度・経度は Google マップで店舗を長押しすると表示される値を使う
- 掲載を止めるときは `is_published = false`、契約の終わりは `listing_ends_on` に入れる
- 送客の実績（掲載店への報告用）：

```sql
select s.name, r.action, count(*) as times, count(distinct r.user_id) as users
  from public.shop_referrals r join public.shops s on s.id = r.shop_id
 where r.created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo')
 group by s.name, r.action order by s.name, r.action;
```

## 6. 複数台プラン

2台目からは複数台プラン（`profiles.plan = 'plus'`）が必要です。アプリ内課金の仕組みが決まるまでは、試験用に SQL で切り替えます。

```sql
update public.profiles set plan = 'plus' where id = '<利用者のID>';
```

## 7. たにぐち自動車への移管に備えて

- Supabase：専用の組織ごと移管できる（組織のオーナー変更）
- Expo：専用のプロジェクトをたにぐち自動車のアカウントへ移管できる
- App Store / Google Play：アプリの移管手続き（販売元が変わる）。アプリID は変わらない
- 秘密情報はカーケイボー専用に発行しているため、移管時に Ledra 側へ影響しない（Ledra の API キーは移管後に再発行を推奨）
