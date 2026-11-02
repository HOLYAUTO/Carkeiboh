#!/usr/bin/env bash
# 本番（production）に EAS Update を配る。必ずこのスクリプトを使う（eas update を直接実行しない）。
#
# 理由：Expo のアカウント（cartrust）には Ledra 用の共有の環境変数（EXPO_PUBLIC_SUPABASE_URL など）があり、
# eas update --environment production で作ると、イジログの値ではなく Ledra の Supabase に向いた版になることがある
# （2026-10-29 に実際に起き、iPhone でログインできなくなった）。
# このスクリプトは接続先をイジログに固定して書き出し、中身に別の Supabase が入っていないことを確かめてから配る。
#
# 使い方: ./scripts/publish-update.sh "変更の内容"
#   DRY_RUN=1 を付けると、書き出しと確認だけを行い、配らない
set -euo pipefail

MESSAGE="${1:?使い方: ./scripts/publish-update.sh \"変更の内容\"}"
CHANNEL=production
# イジログ専用の Supabase（公開してよい値。eas.json の production ビルドにも同じ値を書いている）
SUPABASE_URL=https://ympxgzyvjujnfuoyhilu.supabase.co
SUPABASE_REF=ympxgzyvjujnfuoyhilu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
EAS=(npx -y eas-cli@latest)

if [ -n "$(git status --porcelain)" ]; then
  echo "コミットしていない変更があります。main の状態で配ってください。" >&2
  exit 1
fi

rm -rf dist
"${EAS[@]}" env:exec production "node scripts/export-update.mjs $SUPABASE_URL"

# 書き出した中身の確認：Supabase の接続先がイジログのものだけであること
bundles=$(find dist/_expo/static/js -name '*.hbc' -o -name '*.js' | grep -E '/(ios|android)/')
[ -n "$bundles" ] || { echo "書き出した版が見つかりません。" >&2; exit 1; }
for f in $bundles; do
  hosts=$(grep -a -o -E '[a-z0-9]{20}\.supabase\.co' "$f" | sort -u)
  if [ "$hosts" != "$SUPABASE_REF.supabase.co" ]; then
    echo "接続先が正しくありません（$f）：" >&2
    echo "${hosts:-（Supabase の接続先がない）}" >&2
    exit 1
  fi
done
echo "確認済み：接続先は $SUPABASE_REF.supabase.co だけです"
[ "${DRY_RUN:-}" = 1 ] && { echo "DRY_RUN のため配りません"; exit 0; }

"${EAS[@]}" update --skip-bundler --input-dir dist --channel "$CHANNEL" --environment production \
  --message "$MESSAGE" --non-interactive
