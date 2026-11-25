# イジログ

オイル交換を中心に、クルマの維持費と期限をひと目で分かるようにする個人向けアプリ（初期版）。
権利者・個人情報の取扱事業者は**株式会社たにぐち自動車**、開発・管理は株式会社HOLY（委託先）です。
Ledra のコードは含みません。Ledra とは Ledra が公開する外部API だけで接続します。

- 依頼書：01 カーケイボー開発依頼書（初期版）、02 Ledra 側開発依頼書（Ledra リポジトリで実装）
- **置き場所の決まり**：開発・提出・共有に使うものは英語名（`docs/` など）、人が読むだけの社内資料は [社内資料/](社内資料/) に日本語名で置く（`AGENTS.md` の「ファイルの置き場所と名前」）
- 要確認一覧：[社内資料/要確認一覧.md](社内資料/要確認一覧.md)
- セットアップと配布：[docs/setup.md](docs/setup.md)
- Ledra API の仕様：[docs/ledra-api-contract.md](docs/ledra-api-contract.md)（Ledra 側がこの形に合わせる）

## 構成

| 部分 | 技術 | 場所 |
| --- | --- | --- |
| アプリ | Expo SDK 58（React Native、TypeScript、Expo Router） | `src/app`（画面）、`src/components`、`src/lib` |
| 計算（予測・通知・維持費・ODO） | 純粋な TypeScript。アプリとサーバーで同じコードを使う | `supabase/functions/_shared/domain` |
| サーバー | Supabase（認証、Postgres＋RLS、Edge Functions、pg_cron） | `supabase/` |
| 通知 | Expo Push。毎朝 日本時間 9:00 にサーバーで計算して送る | `supabase/functions/notify-dispatch` |

### Edge Functions

| 関数 | 呼び出し元 | 役割 |
| --- | --- | --- |
| `ledra-preview` | アプリ（同意画面の表示前） | QR を表示した整備工場の店舗名を確かめる（トークンは消費しない） |
| `ledra-link` | アプリ（同意画面） | QR のトークンと同意で Ledra に連携を確定し、初回の取り込み |
| `ledra-unlink` | アプリ（設定） | 連携の解除 |
| `ledra-sync` | pg_cron（毎時） | 前回以降の差分を取り込み。所有者移転などで無効になった連携を止める |
| `notify-dispatch` | pg_cron（毎日 UTC 0:00） | 5.4 のタイミングで事前通知を送る |
| `announce-dispatch` | pg_cron（10分ごと） | 運営からのお知らせ・たにぐち自動車の最新情報のプッシュ通知を送る |
| `vehicle-release` | アプリ（車両情報と周期） | クルマを手放す（乗り換え・廃車）。連携を解除し、廃車は Ledra に伝える。記録は残してアプリから外す |
| `delete-account` | アプリ（設定） | Ledra 連携を解除し、利用者とすべてのデータを削除 |

## 開発

```sh
npm install
cp .env.example .env      # EXPO_PUBLIC_* を設定
npx expo start            # 開発ビルド（eas build --profile development）で開く
```

確認コマンド：

```sh
npm run typecheck         # アプリの型チェック
npx eslint .              # Lint
npm test                  # 計算部分の単体テスト
npm run test:rls          # RLS の試験（使い捨ての PostgreSQL を起動。一般ユーザーで実行）
npm run check:functions   # Edge Functions の型チェック（Deno が必要）
```

## 完成の条件（01 8章）の状況

| 条件 | 状況 |
| --- | --- |
| 4つのタブと、ログイン・初回設定・記録一覧・設定の各画面が動く | **達成**。2026-11-04 に実機で、すべてのタブと各画面が動くことを確認。タブは整備工場を足して5つ（ホーム／維持費／記録する／整備工場／通知。`社内資料/要確認一覧.md` 33） |
| オイル交換の次回目安（距離と期間の早い方）がペース計算込みで正しく出る。計算部分に単体テスト | 実装済み・単体テストあり（`tests/domain`） |
| 5.4 の通知がタイミングどおりにテスト端末へ届く | **達成**。2026-11-04 に実機に通知が届くことを確認。タイミングの計算は単体テスト済み（`tests/domain/reminders.test.ts`） |
| 他人のデータが読めない（RLS のテスト） | 実装済み・試験あり（`tests/rls`、CI でも実行） |
| Ledra のテスト環境から、連携した車両のオイル交換記録が「証明付き」で取り込まれる | 受け取り側は実装済み。Ledra 側は holy-auto/Ledra #1397 で実装（未マージ）。API の形は `docs/ledra-api-contract.md` で確定。**Ledra のテスト環境での通し確認は、鍵の発行後** |
| アカウント削除でデータが消える | 実装済み。外部キーの連鎖削除を RLS 試験で確認 |
| TestFlight と Google Play 内部テストで配布できる | iPhone は TestFlight で配布中（アプリID `app.ijilog`。公開リンクは `社内資料/要確認一覧.md` 45）。**Android は Google Play Console で新しいアプリを作ってから**（`docs/setup.md` 9章） |
