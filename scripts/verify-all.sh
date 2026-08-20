#!/usr/bin/env bash
#
# Everything that can be checked without a phone, in one run.
#
# Each step prints PASS or FAIL and the script keeps going, so one failure does
# not hide the state of everything else. Exits non-zero if anything failed.
#
# The browser and HTTP checks need a running server with the demo seeded; they
# report SKIP rather than FAIL when one is not there.
set -uo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-http://localhost:3000}"
FAILED=0

run() { # name, command...
  local name="$1"; shift
  printf '\n\033[1m==> %s\033[0m\n' "$name"
  if "$@" > /tmp/sanad-verify.log 2>&1; then
    printf '\033[32mPASS\033[0m  %s\n' "$name"
  else
    printf '\033[31mFAIL\033[0m  %s\n' "$name"
    tail -25 /tmp/sanad-verify.log
    FAILED=$((FAILED + 1))
  fi
}

run "TypeScript tests"       pnpm test
run "Python (ASR harness)"   pnpm test:asr
run "Typecheck"              pnpm typecheck
run "Course-agnostic check"  bash scripts/check-course-agnostic.sh
run "Production build"       pnpm build
run "Mobile typecheck"       pnpm --filter @sanad/mobile exec tsc --noEmit
run "Mobile bundle"          pnpm --filter @sanad/mobile exec expo export --platform android --output-dir /tmp/sanad-expo-export

if curl -sf -o /dev/null "$BASE/sign-in"; then
  run "Cross-student isolation" pnpm exec tsx scripts/verify-isolation.ts "$BASE"
  run "Browser UI checks"       node scripts/verify-ui.mjs "$BASE"
else
  printf '\n\033[33mSKIP\033[0m  Isolation and browser checks — no server at %s\n' "$BASE"
  printf '      Start one with: pnpm build && pnpm --filter @sanad/web start\n'
fi

printf '\n'
if [ "$FAILED" -gt 0 ]; then
  printf '\033[31m%d check(s) failed.\033[0m\n' "$FAILED"
  exit 1
fi
printf '\033[32mEverything passed.\033[0m\n'
