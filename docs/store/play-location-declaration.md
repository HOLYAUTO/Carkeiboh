# Google Play：位置情報の権限の申告（バックグラウンドの位置情報）

「スタンドを出たら通知する」（`src/lib/fuel-geofence.ts`）で `ACCESS_BACKGROUND_LOCATION` を使うため、
Play Console の **「ポリシーとプログラム → アプリのコンテンツ → 位置情報の権限」** で申告する。
内部テストのままなら審査は求められないが、クローズド・オープンテスト・製品版に出すときに申告が無いと公開できない。

申告の文面は、アプリの中で出す開示（`src/app/fuel-detect.tsx` の `BACKGROUND_LOCATION_DISCLOSURE`）・
プライバシーポリシー・ストアの説明と食い違わないようにする（審査はこれらを見比べる）。

## 1. 申告フォームに入れる内容

### バックグラウンドで位置情報を使う機能（主な目的）

日本語：

> ガソリンスタンドで給油したあと、記録を忘れないようにお知らせする機能「スタンドを出たら通知する」で使います。
> 利用者が設定でこの機能を選び、位置情報を「常に許可」にした場合だけ、アプリを閉じているときも近くのガソリンスタンド（最大19か所）への出入りを端末のジオフェンスで調べます。
> スタンドに2〜60分いて出たときに「給油しましたか？」と通知し、押すとスタンド名を入れた給油の記録画面を開きます。
> 位置情報は端末の中だけで使い、正確な位置はサーバーに送りません（スタンドの一覧を受け取るために、約5km四方の区画の名前だけを送ります）。広告や第三者への提供には使いません。

English（審査は英語でも読まれるため、併記するか英語だけを入れる）：

> The "Notify me when I leave a gas station" feature uses background location to remind users to log a refuel right after they fill up.
> Only when the user turns this feature on in the app's settings and grants "Allow all the time", the app uses the device's geofencing to detect entering and leaving nearby gas stations (up to 19) while the app is closed.
> When the user has stayed at a station for 2–60 minutes and then leaves, the app shows a local notification ("Did you refuel?"); tapping it opens the refuel entry screen with the station name filled in.
> Location is processed on the device only. Precise location is never sent to our servers (only the name of a ~5 km grid cell is sent to download the list of nearby stations). Location is not used for ads and is not shared with third parties.

### この機能はアプリの中心の機能か

- 「はい」：維持費・給油の記録がアプリの中心の機能で、給油の記録漏れを防ぐための機能である
- 機能をオフにしても（「アプリを開いたときに知らせる」「使わない」）、アプリのほかの機能はそのまま使える

### 前景（フォアグラウンド）の位置情報では足りない理由

> 給油した直後は、利用者はアプリを開いていません。アプリを閉じているあいだにスタンドから出たことを知らないと、記録を勧める通知を出せないためです。
> （English: Users do not have the app open while refueling. Detecting that they left the station while the app is closed is the only way to send the reminder at the right moment.）

### 動画のリンク

下の「2. 動画」を YouTube に「限定公開」で上げ、その URL を入れる。

## 2. 動画（30秒以内）

Android の実機の画面を録画する（設定 → 画面録画）。音声は不要。字幕を入れると伝わりやすい。

| 秒 | 見せるもの |
| --- | --- |
| 0〜5 | イジログを開き、「設定 → 給油の記録のしかた」を開く |
| 5〜10 | 「スタンドを出たら通知する」を選んで「これにする」を押す |
| 10〜15 | アプリの開示（「アプリを閉じているときの位置情報の利用」）が出て、「同意して続ける」を押す |
| 15〜20 | Android の位置情報の許可で「常に許可」を選ぶ |
| 20〜27 | アプリを閉じ、スタンドを出たあとに「給油しましたか？」の通知が届く（実際にスタンドで撮る） |
| 27〜30 | 通知を押すと、スタンド名の入った給油の記録画面が開く |

- 開示のダイアログ（10〜15秒）が、Android の許可の画面（15〜20秒）より**前に**出ているところを必ず映す（審査で見られる）
- 実際のスタンドで撮るのが難しければ、20〜27秒は通知が届いたところから撮ってもよい

## 3. あわせて直すところ

- **データ セーフティ**（アプリのコンテンツ → データ セーフティ）：「位置情報 → おおよその位置情報」を「収集する」にする
  （約5km四方の区画の名前をサーバーに送るため。目的は「アプリの機能」、第三者と「共有しない」、利用者が選んだときだけ＝「任意」）。
  正確な位置情報は端末の外に出さないので「収集しない」のまま
- **プライバシーポリシー**：`社内資料/法務/プライバシーポリシー下書き.md` の第6項（位置情報の利用）を、公開しているポリシーに入れる
- **ストアの説明**：`docs/store/store-listing.md`（「給油の記録を忘れない」の段に、位置情報を常に許可にしたときだけと書いてある）

## 4. 審査で落ちやすいところ

- 開示の文面に「アプリを閉じているときや使っていないときも」「位置情報を収集」の両方の言葉が入っていること（入れてある）
- 開示が、Android の許可の画面より前に、アプリの中の専用の画面（ダイアログ）で出ること（`confirmBackgroundLocation`）
- 開示で「同意しない」を選んだら、許可を求めずに進めること（「アプリを開いたときに知らせる」になる）
- 申告・開示・プライバシーポリシー・ストアの説明で、使い道の説明が同じであること
