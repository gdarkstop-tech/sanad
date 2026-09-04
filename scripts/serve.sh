#!/usr/bin/env bash
#
# Container entrypoint: bring the database up to date, make sure there is
# something to look at, then serve.
#
# Migrations and seeding run on every boot because a hosted container restarts
# on its own schedule and cannot be assumed to have been prepared by hand. Both
# are safe to repeat: migrations are forward-only and tracked, and the demo seed
# returns early when its account already exists.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?DATABASE_URL is not set — the app has no database to talk to}"
: "${APP_SECRET:?APP_SECRET is not set — sessions cannot be signed}"

echo "==> Migrating"
pnpm db:migrate

if [ "${SEED_DEMO:-1}" = "1" ]; then
  echo "==> Seeding demo data (skipped if already present)"
  pnpm db:seed:demo
fi

echo "==> Serving on ${PORT:-7860}"
exec pnpm --filter @sanad/web exec next start --hostname 0.0.0.0 --port "${PORT:-7860}"
