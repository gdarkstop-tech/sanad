#!/usr/bin/env bash
#
# Puts the demo account back exactly as it was. About 30 seconds.
#
# Run this before the real demo: an account that has been clicked through
# already has answered questions and completed study sessions, which changes
# what the coach says.
set -euo pipefail
cd "$(dirname "$0")/.."

DB_URL="${DATABASE_URL:-$(grep -E '^DATABASE_URL=' .env 2>/dev/null | cut -d= -f2- || true)}"
[ -n "$DB_URL" ] || { echo "DATABASE_URL is not set and .env has none." >&2; exit 1; }

# Everything after the last slash, minus any query string.
DB_NAME="${DB_URL##*/}"
DB_NAME="${DB_NAME%%\?*}"
ADMIN_URL="${DB_URL%/*}/postgres"

echo "Resetting $DB_NAME"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);" \
  -c "CREATE DATABASE \"$DB_NAME\";" >/dev/null

DATABASE_URL="$DB_URL" pnpm db:migrate
DATABASE_URL="$DB_URL" pnpm db:seed:demo
