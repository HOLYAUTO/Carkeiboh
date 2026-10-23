#!/usr/bin/env bash
# RLS の試験。使い捨ての PostgreSQL を起動し、Supabase の最小限の再現とマイグレーションを当ててから試験を流す。
# 使い方: npm run test:rls   （PostgreSQL 15 以上の initdb / pg_ctl が必要。PG_BIN で場所を指定できる）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")}"
WORK="$(mktemp -d)"
PORT="${RLS_PG_PORT:-55432}"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$WORK/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

if [ "$(id -u)" = "0" ]; then
  echo "root では PostgreSQL を起動できません。一般ユーザーで実行してください。" >&2
  exit 1
fi

"$PG_BIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start >/dev/null

PSQL=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/tests/rls/supabase-shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$f"
done

RLS_DATABASE_URL="postgresql://postgres@localhost:$PORT/postgres?host=$WORK" \
  npx vitest run --config "$ROOT/vitest.rls.config.mts"
