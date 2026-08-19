#!/usr/bin/env bash
# Turns the course-agnostic rule (brief §32, ARCHITECTURE.md §1.1) into a test.
#
# Every subject term used by a demo course is a term that must NEVER appear in
# application code. The denylist is derived from seed data, so it grows by
# itself as demo courses are added — nobody has to remember to update it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEED="$ROOT/seed/demo-courses.json"

if [[ ! -f "$SEED" ]]; then
  echo "check-course-agnostic: no seed file at $SEED; nothing to check."
  exit 0
fi

# Course titles, vocabulary canonical terms and aliases, topic names.
mapfile -t TERMS < <(node -e '
  const seed = require(process.argv[1]);
  const out = new Set();
  for (const course of seed.courses ?? []) {
    if (course.title) out.add(course.title);
    for (const v of course.vocabulary ?? []) {
      if (v.canonicalTerm) out.add(v.canonicalTerm);
      for (const a of v.aliases ?? []) out.add(a);
    }
    for (const t of course.topics ?? []) out.add(t);
  }
  for (const term of out) if (term.trim().length >= 4) console.log(term.trim());
' "$SEED")

if [[ ${#TERMS[@]} -eq 0 ]]; then
  echo "check-course-agnostic: no terms extracted; nothing to check."
  exit 0
fi

SEARCH_PATHS=()
[[ -d "$ROOT/apps" ]] && SEARCH_PATHS+=("$ROOT/apps")
[[ -d "$ROOT/packages" ]] && SEARCH_PATHS+=("$ROOT/packages")
if [[ ${#SEARCH_PATHS[@]} -eq 0 ]]; then
  echo "check-course-agnostic: no application code yet."
  exit 0
fi

violations=0
for term in "${TERMS[@]}"; do
  hits=$(grep -rniF --include='*.ts' --include='*.tsx' --include='*.js' --include='*.py' \
      --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist \
      --exclude='*.test.ts' --exclude='*.test.tsx' --exclude='*.spec.ts' \
      -- "$term" "${SEARCH_PATHS[@]}" 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    echo "FAIL: subject term '$term' appears in application code:"
    echo "$hits" | sed 's/^/    /'
    violations=$((violations + 1))
  fi
done

if [[ $violations -gt 0 ]]; then
  cat >&2 <<'MSG'

Course-agnostic check failed.

Subjects, vocabulary, and topics belong in the database, not in code. Move the
value into seed data or a configuration table. See ARCHITECTURE.md section 1.1.
MSG
  exit 1
fi

echo "check-course-agnostic: OK (${#TERMS[@]} seeded terms, none present in application code)."
