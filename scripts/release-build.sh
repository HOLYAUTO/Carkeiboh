#!/usr/bin/env bash
# ストア版を作り、iOS は TestFlight、Android は Google Play の内部テストへそのまま提出する。
#
# - ネイティブの部品・app.json を変えたときはこれで配る（JavaScript だけの修正は publish-update.sh）
# - 接続先は eas.json の production ビルドで固定している（Ledra の Supabase に向かない）
# - Android の自動提出には、EAS に Google Play のサービスアカウントの鍵が登録されていること（docs/setup.md 3章）
#
# 使い方: ./scripts/release-build.sh            # iOS と Android
#         ./scripts/release-build.sh ios        # iOS だけ
#         ./scripts/release-build.sh android    # Android だけ
set -euo pipefail

PLATFORM="${1:-all}"
case "$PLATFORM" in all | ios | android) ;; *) echo "使い方: ./scripts/release-build.sh [all|ios|android]" >&2; exit 1 ;; esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "コミットしていない変更があります。コミットしてから実行してください。" >&2
  exit 1
fi

# --auto-submit：ビルドが終わったら eas.json の submit.production（TestFlight・内部テスト）へ提出する
npx -y eas-cli@latest build --profile production --platform "$PLATFORM" --auto-submit --non-interactive --no-wait
echo "ビルドと提出の進み具合は https://expo.dev/accounts/cartrust/projects/carkeibo/builds で見られます。"
