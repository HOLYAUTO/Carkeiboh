# セットアップと配布の手順

アカウント（Apple Developer、Google Play Console、Supabase、Expo）は株式会社HOLY 名義で作り、
将来たにぐち自動車へ移管できるよう、すべてイジログ専用にします（Ledra と共有しない）。

## 1. Supabase（イジログ専用の組織・プロジェクト）

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
   - Redirect URLs に `ijilog://auth/callback` を追加
4. Edge Functions をデプロイし、secrets を設定する
   ```sh
   npx supabase functions deploy
   npx supabase secrets set LEDRA_API_BASE_URL=... LEDRA_API_KEY=... CRON_SECRET=... EXPO_ACCESS_TOKEN=... ANTHROPIC_API_KEY=...
   ```
   - `ANTHROPIC_API_KEY` は「写真で入力」（`read-record-photo`）で使う。イジログ専用の Claude API キーを発行する
5. 定期実行を登録する：拡張 `pg_cron`・`pg_net` を有効にし、Vault に `project_url`・`cron_secret` を登録してから `supabase/cron.example.sql` を実行
   - Ledra 取得：毎時（`ledra-sync`）
   - 事前通知：毎日 UTC 0:00 = 日本時間 9:00（`notify-dispatch`）
   - お知らせのプッシュ通知：10分ごと（`announce-dispatch`）
   - 複数台プランの定期購入の照合：毎日 UTC 19:17 = 日本時間 4:17（`billing-reconcile`。6章）

## 2. Expo / EAS（イジログ専用のプロジェクト）

1. `npx eas-cli@latest init` でプロジェクトを作り、`app.json` の `extra.eas.projectId` に入る ID を確認する
2. アプリID は `app.ijilog`（iOS のバンドルID・Android のパッケージ名。公開後は変更できない）
3. 環境変数（EAS の Environment variables）に `.env.example` の `EXPO_PUBLIC_*` を設定する
4. プッシュ通知の資格情報：iOS は APNs キー、Android は FCM v1 のサービスアカウントキーを EAS に登録する
5. 開発ビルド：`npx eas-cli@latest build --profile development`
   - 音声入力（`expo-speech-recognition`）・位置情報・端末での写真の読み取り（`modules/ijilog-ocr`）はネイティブモジュールを使うため、Expo Go では動かない（音声入力は「使えません」と案内し、写真はサーバーでの読み取りだけになる）。開発ビルドで確かめる
   - Android の端末での読み取りは、Google Play 開発者サービスが日本語の文字認識モデルを取得してから使える（インストール直後に取得を始める。取得前はサーバーでの読み取りに回る）

## 3. 限定配布（TestFlight・Google Play 内部テスト）

```sh
./scripts/release-build.sh   # iOS・Android をビルドし、TestFlight と内部テストへそのまま提出（ios / android だけも可）
```

すでにできたビルドを提出し直すとき：

```sh
npx eas-cli@latest submit --profile production --platform ios --latest      # TestFlight
npx eas-cli@latest submit --profile production --platform android --latest  # 内部テスト（track: internal）
```

#### Android を自動で提出するための準備（最初の1回だけ）

EAS が Google Play に提出するには、Google Play のサービスアカウントの鍵（JSON）を EAS に登録しておく。鍵はリポジトリに入れない。

1. Google Cloud コンソールで、Play Console に紐づけるプロジェクトを選び、「Google Play Android Developer API」を有効にする
2. 「IAM と管理 → サービスアカウント」でサービスアカウント（例：`eas-submit`）を作り、「鍵 → 鍵を追加 → JSON」で鍵をダウンロードする
3. Play Console の「ユーザーと権限 → 新しいユーザーを招待」で、サービスアカウントのメールアドレスを招待し、イジログ（`app.ijilog`）に
   「テスト トラックへのリリース」（とアプリの情報の閲覧）の権限を付ける
4. expo.dev の cartrust / carkeibo →「Credentials → Android → app.ijilog → Google Service Account Key for Play Store Submissions」に鍵の JSON をアップロードする
   （または `npx eas-cli@latest credentials --platform android` → production → Google Service Account → Upload）
5. 最初の1回だけは、Play Console に AAB を手でアップロードしてあること（Google の API が、まだリリースの無いアプリには提出させないため）

- ストア上の販売元は HOLY と表示されるため、アプリ名・概要でたにぐち自動車のアプリであることが分かるようにする（`app.json` の `description`、App Store の概要・Google Play の説明）
- 利用規約・プライバシーポリシー（名義はたにぐち自動車、HOLY は開発・管理の委託先）の URL を、アプリ（`EXPO_PUBLIC_TERMS_URL` / `EXPO_PUBLIC_PRIVACY_URL`）とストアの両方に設定する

### 画面や計算の修正だけを配る（EAS Update）

JavaScript・画像だけの修正は、ストアの審査を通さずに配れます。端末はアプリを開いたときに更新を取りに行き、次に開いたときから新しい版になります。

```sh
./scripts/publish-update.sh "変更の内容"            # 本番に配る（eas update を直接実行しない）
DRY_RUN=1 ./scripts/publish-update.sh "変更の内容"  # 書き出しと接続先の確認だけ
```

- **配るときはスクリプトを使う**：スクリプトは接続先をイジログに固定して書き出し、中身にほかの Supabase が入っていないことを確かめてから配る。
  以前は Expo のアカウント（cartrust）に Ledra 用の共有の環境変数（`EXPO_PUBLIC_SUPABASE_URL` など）があり、`eas update` を直接実行すると
  Ledra の Supabase に向いた版が配られることがあった（2026-10-29 に起き、ログインできなくなった）。共有の環境変数は 2026-11-20 に削除したが、
  間違った接続先の版を配らないための確認として、引き続きスクリプトを使う
- EAS の環境変数はイジログのプロジェクトのものだけ（production・preview・development のどれにも `EXPO_PUBLIC_SUPABASE_URL`・`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`・`EXPO_PUBLIC_PRIVACY_URL`・`EXPO_PUBLIC_TERMS_URL`）。
  アカウントの共有の環境変数は置かない（同じアカウントのほかのアプリの値が混ざるため）
- ビルド（`eas build`）は、念のため `eas.json` の production と preview にも接続先を書いて固定している

- ビルドの種類（`eas.json` の `development` / `preview` / `production`）ごとに、同じ名前の channel の更新を受け取る
- 更新を受け取れるのは `expo-updates` を入れた後のビルドだけ。それより前に配ったビルドには届かない
- `runtimeVersion` は `fingerprint`。ネイティブのライブラリや `app.json` を変えるとこの値が変わり、古いビルドには配られなくなる（作り直したビルドにだけ届く）。ネイティブ部分が合わない更新を配ってアプリが落ちるのを防ぐため
- `app.json` を変えたときや、ネイティブのライブラリを足したときは EAS Update ではなくビルドを作り直す

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

## 6. 複数台プラン（アプリ内課金）

2台目からは複数台プランが必要です。App Store / Google Play のアプリ内課金で申し込み、購入の確認はサーバー（Edge Functions）が自前で行います（外部の課金サービスは使わない）。

- 購入の流れ：アプリで購入 → `billing-verify` がストアの API に状態をたずねて `billing_purchases` に記録 → アプリが購入を完了にする
- 更新・解約・返金：ストアからの通知を `billing-notify` が受け取り、ストアの API で状態を取り直す。通知の取りこぼしは `billing-reconcile`（毎日）で補う
- プランは記録の「使える期限（`entitled_until`）」から毎回求める（`effective_plan`）。期限を過ぎれば、通知が届かなくても無料プランに戻る
- 解約後に上限を超えたら、アプリが「残すクルマを選ぶ」画面を出す。選ばなかったクルマは休止（`vehicles.plan_suspended_at`）になり、記録・お知らせ・Ledra 連携の対象外になる（データは消さない）
- 再契約すると、休止から90日以内のクルマは自動で戻る。90日を過ぎたものは、復旧の事務手数料（1回限りの購入）も要る。Ledra 連携は取り込みの位置を進めずに止めているので、戻すと止まっていた間の記録を取り込む

### ストアに登録する商品

App Store Connect と Google Play Console で、**同じ商品ID** を使う（`supabase/functions/_shared/domain/billing.ts`）。料金は仮の値（`社内資料/要確認一覧.md` 30）。

| 商品ID | 種類 | 料金（仮） |
| --- | --- | --- |
| `ijilog_plus_monthly` | 自動更新の定期購入（1か月）。Google Play は基本プランを1つ（自動更新・1か月）作る | 月額500円（税込） |
| `ijilog_restore_fee` | App Store は「消耗型」、Google Play は「1回限りのアイテム」 | 1,000円（税込） |

- App Store Connect：先に「有料 App 契約」を結び、銀行口座・税務情報を登録する。定期購入はサブスクリプショングループ「複数台プラン」を作ってその中に置く。審査用のスクリーンショットと説明も要る
- Google Play Console：収益化の設定（お支払いプロファイル）を済ませる

### サーバーの鍵と通知の設定

1. **App Store Server API の鍵**：App Store Connect → ユーザとアクセス → 統合 → 「アプリ内課金」でキーを作り、.p8 ファイルを保存する（再ダウンロードできない）
2. **Google Play の権限**：EAS Submit と同じサービスアカウントに、Play Console の「ユーザーと権限」で「財務データ、注文、解約アンケートの回答を表示」と「注文と定期購入の管理」を追加する
3. secrets を設定する
   ```sh
   npx supabase secrets set \
     APPLE_BUNDLE_ID=app.ijilog \
     APPLE_IAP_ISSUER_ID=<発行者ID> APPLE_IAP_KEY_ID=<キーID> APPLE_IAP_PRIVATE_KEY="$(cat SubscriptionKey_XXXX.p8)" \
     GOOGLE_PLAY_PACKAGE_NAME=app.ijilog GOOGLE_PLAY_SERVICE_ACCOUNT_JSON="$(cat service-account.json)" \
     BILLING_NOTIFY_SECRET=<長い乱数>
   ```
   鍵のファイルは設定したら手元から消す
4. **App Store の通知**：App Store Connect → アプリ → App 情報 → 「App Store サーバー通知」の本番・サンドボックスの両方に、次の URL（バージョン2）を入れる
   `https://<project-ref>.supabase.co/functions/v1/billing-notify?source=apple&key=<BILLING_NOTIFY_SECRET>`
5. **Google Play の通知**：サービスアカウントと同じ Google Cloud のプロジェクトで Pub/Sub のトピックを作り、`google-play-developer-notifications@system.gserviceaccount.com` にパブリッシャーの権限を付ける。そのトピックに push のサブスクリプションを作り、エンドポイントを
   `https://<project-ref>.supabase.co/functions/v1/billing-notify?source=google&key=<BILLING_NOTIFY_SECRET>` にする。Play Console → 収益化のセットアップ → 「リアルタイム デベロッパー通知」にトピック名を入れ、「テスト通知を送信」で届くことを確かめる
6. 定期実行：`supabase/cron.example.sql` の `billing-reconcile-daily` を登録する

### 試験

- iOS：TestFlight（サンドボックス）で購入すると、`billing_purchases.environment = 'sandbox'` で記録される。サンドボックスでは1か月の定期購入が5分で更新される
- Android：Play Console の「ライセンス テスト」にテスト用の Google アカウントを登録し、内部テストのビルドで購入する
- 課金を使わずに複数台プランにするとき（運営・試験用）：
  ```sql
  update public.profiles set plan = 'plus' where id = '<利用者のID>';
  ```

## 7. お知らせ・スポンサー広告（運営スタッフ）

お知らせ（アップデート・修正のお知らせ／たにぐち自動車の最新情報）とスポンサー広告は、
運営スタッフがアプリの「設定 → 運営メニュー」から登録します。Google などの外部の広告サービスは使いません。

### スタッフの登録

スタッフにするアカウントでアプリにログインし、クルマの初回登録まで済ませてもらってから（設定画面を開くため）、
SQL エディタ（service_role）で所属を登録します。

```sql
-- 利用者の ID はメールアドレスから調べる
select id, email from auth.users where email = 'staff@example.com';

insert into public.staff_members (user_id, org, display_name)
values ('<利用者のID>', 'taniguchi', '店長');   -- org は 'holy' または 'taniguchi'

-- 外すとき
delete from public.staff_members where user_id = '<利用者のID>';
```

| | HOLY | たにぐち自動車 |
| --- | --- | --- |
| アップデート・修正のお知らせ | 書ける | — |
| たにぐち自動車の最新情報 | 代わりに書ける | 書ける |
| スポンサー広告 | すべて編集できる | 自社が管理する広告を編集できる（他社の広告は見るだけ） |
| 表示・タップの数 | すべて | 自社が管理する広告の分 |

### お知らせの配信

- 「公開する」をオンにすると、公開の日時からホームとお知らせの一覧に出る（日時を先にすれば予約になる）
- 「プッシュ通知も送る」をオンにすると、公開の日時から10分以内に1回だけ送る（`announce-dispatch`）
  - アップデート・修正のお知らせ：通知を許可しているすべての利用者
  - たにぐち自動車の最新情報：アプリで「受け取る」を選んだ利用者だけ（既定は受け取らない）
- EAS Update で修正を配ったときは、アプリが自動で取り込み、ホームに「アプリの修正が届きました（再起動して反映する）」を出す。
  何を直したかを知らせたいときは、あわせて「アップデート・修正のお知らせ」を出す

送る前に、送り先の数だけ確かめられます。

```sh
curl -X POST "$SUPABASE_URL/functions/v1/announce-dispatch" \
  -H "x-cron-secret: $CRON_SECRET" -H 'content-type: application/json' -d '{"dryRun":true}'
```

### 広告の掲載

- 出す場所：ホーム（期限の一覧の下）、維持費（一番下）、整備工場（一覧の下）。どの場所でも「PR」と広告主の名前を必ず出す
- 同じ場所に複数の広告があるときは、表示の重みに比例した割合で出す。画面を開くたびに選び直す
- 画像は横2：縦1に切り抜き、公開バケット `sponsor-images` に置く（URL を知っていれば誰でも見られるため、広告に出せる画像だけを使う）
- 表示・タップの数は「スポンサー広告の管理」で月ごとに見られる（同じ起動のあいだに同じ画面で出した分は1回と数える）。広告主への報告用に SQL エディタで出す場合：

```sql
select a.sponsor_name, a.title, e.action, count(*) as times, count(distinct e.user_id) as users
  from public.sponsor_ad_events e join public.sponsor_ads a on a.id = e.ad_id
 where e.created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'
 group by a.sponsor_name, a.title, e.action order by a.sponsor_name, a.title, e.action;
```

## 8. たにぐち自動車への移管に備えて

- Supabase：専用の組織ごと移管できる（組織のオーナー変更）
- Expo：専用のプロジェクトをたにぐち自動車のアカウントへ移管できる
- App Store / Google Play：アプリの移管手続き（販売元が変わる）。アプリID は変わらない
- 秘密情報はイジログ専用に発行しているため、移管時に Ledra 側へ影響しない（Ledra の API キーは移管後に再発行を推奨）

## 9. アプリID の切り替え（app.carkeibo → app.ijilog、2026-10-31）

「カーケイボー」に他社の商標登録があるため、アプリ名だけでなく識別子も `ijilog` に変えた。
アプリID が変わるとストアでは別のアプリになるので、次の順で切り替える。

1. **Expo**：expo.dev のプロジェクトの表示名（Display name）を `ijilog` にした（2026-10-31）。
   slug（`carkeibo`）は expo.dev の URL に出るだけで利用者には見えないため、変えずに残す。
   `app.json` の `slug` と `extra.eas.projectId` もそのままなので、環境変数・プッシュ通知の送り先は引き継がれる
2. **Apple**：App Store Connect で新しいアプリ（バンドルID `app.ijilog`、名前「イジログ」）を作る。
   - バンドルID と Sign in with Apple の設定は、`eas build` が Apple Developer に自動で作る
   - 作ったアプリの「Apple ID」（数字）を `eas.json` の `submit.production.ios.ascAppId` に入れる
3. **Google**：Google Play Console で新しいアプリ（パッケージ名 `app.ijilog`）を作る。最初の1回は、ビルドした AAB を手でアップロードする
4. **Supabase**：Authentication → Providers → Apple の Client IDs を `app.ijilog,app.carkeibo` にする（古いアプリが残っている間は両方を入れる）。
   Redirect URLs に `ijilog://auth/callback` を追加する
5. ビルドして配る（3章）。新しい TestFlight の公開リンク・内部テストの参加リンクを、
   EAS の環境変数 `EXPO_PUBLIC_IOS_INSTALL_URL`・`EXPO_PUBLIC_ANDROID_INSTALL_URL` に入れる（アプリの「アプリを紹介する」の QRコードに出る）
6. 今のテスターに、新しいアプリを入れ直してもらう。同じ Apple ID・メールでログインすれば記録はそのまま残る。
   画面の色・選んでいたクルマの設定は端末に保存しているので、初めの状態に戻る。
   古いアプリは、全員が移ったら TestFlight の配布を止める
