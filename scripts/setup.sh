#!/usr/bin/env bash
#
# One-command setup, from a clean checkout to a seeded demo account.
#
#   bash scripts/setup.sh              # uses DATABASE_URL from .env
#   bash scripts/setup.sh --docker     # starts PostgreSQL in Docker first
#
# Everything here is free and local: no cloud account, no API key, no paid
# service. Safe to re-run — it only creates what is missing.
set -euo pipefail

cd "$(dirname "$0")/.."
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

USE_DOCKER=0
[ "${1:-}" = "--docker" ] && USE_DOCKER=1

step "Checking prerequisites"
command -v node >/dev/null || die "Node is not installed. Sanad needs Node 22 or newer."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || die "Node $NODE_MAJOR found; Sanad needs 22 or newer."
command -v pnpm >/dev/null || die "pnpm is not installed. Install it with: npm install -g pnpm"
echo "node $(node -v), pnpm $(pnpm -v)"

if [ "$USE_DOCKER" = "1" ]; then
  step "Starting PostgreSQL in Docker"
  command -v docker >/dev/null || die "Docker is not installed. Re-run without --docker and use a local PostgreSQL."
  docker compose up -d
  printf 'waiting for postgres'
  for _ in $(seq 1 40); do
    if docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
      echo ' ready'
      break
    fi
    printf '.'
    sleep 1
  done
fi

step "Installing dependencies"
pnpm install

step "Creating .env"
if [ -f .env ]; then
  echo ".env already exists — leaving it alone."
else
  cp .env.example .env
  # A real secret, so nobody ships the placeholder by accident.
  SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')
  node -e '
    const fs = require("fs");
    const secret = process.argv[1];
    fs.writeFileSync(".env", fs.readFileSync(".env", "utf8")
      .replace(/^APP_SECRET=.*$/m, `APP_SECRET=${secret}`));
  ' "$SECRET"
  echo "Wrote .env with a generated APP_SECRET."
fi

step "Checking the database connection"
node -e '
  const fs = require("fs");
  const line = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.*)$/m);
  if (!line) { console.error("DATABASE_URL is not set in .env"); process.exit(1); }
  console.log("DATABASE_URL =", line[1].replace(/:[^:@/]*@/, ":****@"));
'
pnpm exec tsx scripts/check-db.ts || die "Could not reach PostgreSQL. Start it, or re-run with --docker."

step "Applying migrations"
pnpm db:migrate

step "Seeding the demo account"
pnpm db:seed:demo

step "Done"
cat <<'EOF'

Start the web app:      pnpm dev            → http://localhost:3000
Start the mobile app:   pnpm mobile         → scan the QR code with Expo Go

Sign in with the account the seed printed above.

Reset the demo at any time:   pnpm demo:reset
EOF
