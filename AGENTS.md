This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## このリポジトリについて

- イジログ（株式会社たにぐち自動車のアプリ）。Ledra のコードを複製・流用しない。Ledra とは外部API だけで接続する
- 予測・通知・維持費・ODO の計算は `supabase/functions/_shared/domain` に置き、アプリ（`@domain/*`）と Edge Functions の両方から使う。Deno でも動くよう、相対 import には `.ts` を付け、外部パッケージに依存しない
- DB を変えたら `npm run test:rls`、計算を変えたら `npm test` を流す
- 決まっていない項目は推測で埋めず、仮の値で実装して `docs/open-questions.md` に追記する
- 画面に出すエラーには必ずエラーコード（`IJ-分類-3桁`）を付ける。`alertError`・`describeError`・`withCode`（`src/lib/error-codes.ts`）と `ErrorView` の `code` を使い、生の `e.message` だけを出さない。新しい原因には新しいコードを作り、`src/lib/error-codes.ts` と `docs/error-codes.md` の表の両方に足す（`npm test` で一致を確かめる）。原因が分かった不具合は、`docs/error-codes.md` の「起きたことの記録」に残す
- マイグレーションは、`supabase/migrations/` に作った時点で本番の Supabase に適用する（2026-11-05 決定。マージを待たない）
  - 適用先はイジログの本番プロジェクト「カーケイボー」（`ympxgzyvjujnfuoyhilu`、`eas.json` の `EXPO_PUBLIC_SUPABASE_URL` と同じ）。同じ組織にある Ledra・Ledra-staging には絶対に当てない
  - 当てる前に `npm run test:rls` を通し、`supabase_migrations.schema_migrations` を見て未適用のものだけを当てる
  - 適用の仕組みが履歴に現在時刻の番号を付けたら、ファイル名の番号（例：`20261105000001`）に直す（`supabase db push` で同じものを二重に流さないため）
  - 当てたら列・制約が入ったことを確かめ、PR の説明に「本番に適用済み」と書く
