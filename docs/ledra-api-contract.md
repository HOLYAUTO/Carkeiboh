# Ledra 外部API の想定（カーケイボー側が前提にしている形）

別紙02「Ledra 側開発依頼書：カーケイボー連携API」で Ledra に追加する API を、カーケイボーの受け取り側は以下の形で呼んでいます。
**02 にはエンドポイントの形が定義されていないため、これは仮の想定です【要確認】。**
Ledra 側の実装が決まったら、カーケイボー側は次の2ファイルだけを直せば合わせられます。

- `supabase/functions/_shared/ledra-client.ts`（呼び出し）
- `supabase/functions/_shared/ledra-records.ts`（応答の変換・QR の読み取り・同意の文言）

## 認証

- `Authorization: Bearer <LEDRA_API_KEY>`
- キーはカーケイボー専用に、Ledra の外部API管理画面（`/admin/platform/passport-consumers`）で発行したもの。スコープは仮に `consumer_app:oil_records`
- キーはカーケイボーのサーバー（Supabase Edge Functions の secrets）だけに置き、アプリには埋め込まない

## QR コード

- 中身は「使い捨てトークンだけ」または「`?token=` 付きの URL」のどちらでも読める（`extractLinkToken`）
- トークンは英数字と `._~-` の 16〜512 文字を想定
- 車体番号・個人情報は含まない（02 の 3.1）。有効期限 15 分

## 1. 連携の確定

```
POST /v1/consumer-links
{
  "token": "<QR のトークン>",
  "consent": {
    "version": "2026-10-23",
    "recipient": "株式会社たにぐち自動車",
    "items": ["作業日", "走行距離（ODO）", "オイル交換の有無", "オイルフィルター交換の有無", "店舗名"],
    "agreed_at": "2026-10-23T01:23:45.000Z",
    "consumer_link_ref": "<カーケイボー側の連携ID（利用者のアカウントIDではない）>"
  }
}
```

| 応答 | カーケイボー側の扱い |
| --- | --- |
| `201` `{ "link_id": "...", "shop_name": "..." }` | 連携成立。`shop_name` は任意（あれば同意の控えと画面に出す） |
| `400` / `404` / `409` / `410` | 「QR の有効期限が切れたか、すでに使われています」と表示 |
| それ以外 | エラー表示 |

`consent` は、Ledra 側で同意の記録（いつ・誰が・どの車両に・どの範囲で・提供先）を残すための材料です。「誰が」は利用者を特定しない `consumer_link_ref` で渡しています（必要なら Ledra 側で別の値を指定してください）。

## 2. オイル交換記録の取得（差分）

```
GET /v1/consumer-links/{link_id}/oil-records?since=<cursor>
```

```json
{
  "records": [
    {
      "record_id": "rec_123",
      "work_date": "2026-10-01",
      "odo_km": 41000,
      "oil_changed": true,
      "filter_changed": false,
      "shop_name": "たにぐち自動車 本店"
    }
  ],
  "next_cursor": "opaque-cursor",
  "has_more": false
}
```

- 初回は `since` なし。以後は前回の `next_cursor` を渡す
- 同じ `record_id` が再度来たら、訂正として上書きする
- 上の6項目以外が含まれていても取り込まない（氏名・住所・電話番号・他の整備・写真・金額は受け取らない）
- `403` / `404` / `410` は「連携が無効（解除・所有者移転など）」とみなし、以後は取得しない
- 呼び出しは 1時間ごと＋連携確定の直後に1回（有効な連携1件につき）

## 3. 連携の解除

```
DELETE /v1/consumer-links/{link_id}
```

- `2xx` / `404` / `410` を解除済みとみなす
- 失敗した場合、カーケイボー側は取得を先に止め、解除の通知を1時間ごとに再送する

## 02 側への追加の提案【要確認】

- **トークンの事前照会**（例：`GET /v1/consumer-link-tokens/{token}` → 店舗名・有効期限）
  01 の 5.5 は同意画面に「提供元（整備工場・Ledra）」の明記を求めていますが、02 の API だけでは同意の前に店舗名が分かりません。
  現状は「QR を表示した整備工場（Ledra を利用する店舗）」と表示しています。照会APIがあれば店舗名を出せます。
