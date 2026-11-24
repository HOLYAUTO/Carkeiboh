# App Store Connect：アプリ内課金の商品を作る

商品ID はアプリ（`supabase/functions/_shared/domain/billing.ts`）と同じにする。違うと、アプリが商品を見つけられない。
料金は仮（`docs/open-questions.md` 30）。ストアで変えれば、アプリの表示も変わる（アプリはストアの価格を出す）。

## 0. 前提

- 有料 App 契約が「有効」（2026-11-13 に同意済み）。銀行口座・税務情報も入っていること
- 販売名義は株式会社HOLY（`docs/open-questions.md` 81）

## 1. 最初のバージョンで出すもの

**定期購入（複数台プラン）だけを出す**。事務手数料は、プランを解約して90日たったクルマにしか出ないため、
審査する人が画面までたどり着けない（「見つからない商品」として差し戻されやすい）。最初の審査が通ったあとに、商品だけで審査に出す。
事務手数料の商品が審査を通るまでは、アプリはボタンに金額を出せないが、新しく始めた人がそこまで行くのは早くても90日後。

## 2. 定期購入：複数台プラン

App Store Connect → マイApp → イジログ →「収益化」→「サブスクリプション」

**サブスクリプショングループ**
| 欄 | 入れるもの |
| --- | --- |
| 参照名 | 複数台プラン |
| ローカリゼーション（日本語）の表示名 | 複数台プラン |

**サブスクリプション**（グループの中に「作成」）
| 欄 | 入れるもの |
| --- | --- |
| 参照名 | 複数台プラン（月額） |
| 製品 ID | `ijilog_plus_monthly` |
| サブスクリプション期間 | 1か月 |
| 配信可否 | アプリと同じ国・地域（日本） |
| サブスクリプション価格 | 日本：500円（ほかの国は自動の換算でよい） |
| ファミリー共有 | オフ |
| ローカリゼーション（日本語）表示名 | 複数台プラン |
| ローカリゼーション（日本語）説明 | 2台目以降のクルマも登録できます（最大5台） |
| 審査用のスクリーンショット | アプリの「複数台プラン」の画面（申し込むボタンが見えるところ）。下の4章 |
| 審査メモ | 下の「審査メモ（定期購入）」 |

審査メモ（定期購入）：
```
How to find: Settings > クルマの切り替え・追加 > 複数台プランを見る (or tap "プランを見る" when adding a second vehicle).
The first vehicle is free. This auto-renewable monthly subscription lets the user register up to 5 vehicles.
Restore purchases: the same screen has "購入を復元". Terms of use and privacy policy are linked at the bottom of the screen.
```

## 3. 消耗型：復旧の事務手数料（最初の審査のあと）

「収益化」→「App 内課金」→「作成」
| 欄 | 入れるもの |
| --- | --- |
| 種類 | 消耗型 |
| 参照名 | 復旧の事務手数料 |
| 製品 ID | `ijilog_restore_fee` |
| 価格 | 日本：1,000円 |
| ローカリゼーション（日本語）表示名 | 表示の復旧の事務手数料 |
| ローカリゼーション（日本語）説明 | 休止から90日を過ぎたクルマの表示を戻します |
| 審査用のスクリーンショット | 「複数台プラン」の画面の「事務手数料を払って表示を戻す」（試験用の利用者で休止を作って撮る） |
| 審査メモ | 下の「審査メモ（事務手数料）」 |

審査メモ（事務手数料）：
```
This one-time fee appears only for vehicles that were paused more than 90 days ago after the multi-vehicle plan ended
(Settings > クルマの切り替え・追加 > 複数台プランを見る > "事務手数料を払って表示を戻す"). It restores access to the paused vehicle's records.
```

## 4. 審査用のスクリーンショットの撮り方

1. TestFlight のビルド11を入れた iPhone で、1台目のクルマを登録したアカウントでログインする
2. 設定 → クルマの切り替え・追加 → 複数台プランを見る
3. 料金と「申し込む（¥500／月）」が見えるところで撮る（商品を作ってから数分〜数時間で、サンドボックスの料金が出るようになる）

## 5. バージョンに付ける

「配信」タブ → 左の列の「iOSアプリ」のバージョン（1.0）→「App 内課金とサブスクリプション」→ `ijilog_plus_monthly` を選ぶ。
状態が「送信準備完了」になっていないと選べない（スクリーンショット・説明・価格が足りないと「メタデータが不足」のまま）。

## 6. サーバー側（購入を確かめる仕組み）

購入の確認はサーバーが行う（`docs/setup.md` 6章「サーバーの鍵と通知の設定」）。審査では実際に買うので、これが無いと
「買ったのに2台目が登録できない」となり差し戻される。

- [ ] App Store Server API のキー（アプリ内課金）を作り、Supabase の secrets（`APPLE_IAP_ISSUER_ID`・`APPLE_IAP_KEY_ID`・`APPLE_IAP_PRIVATE_KEY`・`APPLE_BUNDLE_ID`・`BILLING_NOTIFY_SECRET`）に入れる
- [ ] App 情報 →「App Store サーバー通知」の本番・サンドボックスに `billing-notify` の URL（バージョン2）を入れる
- [ ] `billing-verify`・`billing-notify`・`billing-reconcile` を本番にデプロイする
- [ ] TestFlight で買ってみて、2台目を登録できること・`billing_purchases` に `environment = 'sandbox'` で記録されることを確かめる
