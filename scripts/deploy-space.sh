#!/usr/bin/env bash
#
# Deploys the current branch to a Hugging Face Space.
#
# A Space is configured by a YAML block at the top of README.md. That block is
# noise in a README people actually read, so it does not live on the working
# branch: this rebuilds a throwaway `deploy/hf-space` branch from wherever you
# are, adds the block there, and force-pushes that to the Space.
#
# Rebuilt from scratch every time rather than merged, so it can never conflict
# and can never drift from the branch you are actually working on.
#
# First time:
#   git remote add space https://huggingface.co/spaces/<you>/sanad
#   bash scripts/deploy-space.sh
#
# After that, `pnpm deploy:space` is the whole deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE="${SPACE_REMOTE:-space}"
BRANCH="deploy/hf-space"

if ! git remote get-url "$REMOTE" > /dev/null 2>&1; then
  cat >&2 <<'MISSING'
No git remote named "space".

Create the Space first (huggingface.co/new-space → SDK: Docker → Blank), then:

  git remote add space https://huggingface.co/spaces/<your-username>/sanad

MISSING
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "You have uncommitted changes. Commit or stash them first — a deploy" >&2
  echo "should be of something you can get back to." >&2
  exit 1
fi

SOURCE="$(git rev-parse --abbrev-ref HEAD)"
if [ "$SOURCE" = "$BRANCH" ]; then
  echo "Already on $BRANCH. Switch to the branch you want to deploy." >&2
  exit 1
fi

echo "==> Building $BRANCH from $SOURCE"
git checkout -q -B "$BRANCH" "$SOURCE"

# Leave on failure and the checkout would strand you on the deploy branch.
trap 'git checkout -q "$SOURCE"' EXIT

python3 - <<'PY'
import pathlib

# app_port must match the Dockerfile's PORT. sdk: docker is what makes the Space
# build the Dockerfile rather than look for a Python entrypoint.
FRONT_MATTER = """---
title: Sanad
emoji: 📘
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

"""

readme = pathlib.Path('README.md')
body = readme.read_text()
if body.startswith('---\n'):
    # Already carries a block; replace it rather than stacking a second one.
    body = body.split('\n---\n', 1)[1].lstrip('\n')
readme.write_text(FRONT_MATTER + body)
print('README.md: Space configuration written')
PY

git add README.md
git commit -q -m "Configure the Hugging Face Space" || true

echo "==> Pushing to $REMOTE"
# Force, because this branch is rebuilt each time and the Space is a deploy
# target rather than shared history.
git push -f "$REMOTE" "$BRANCH:main"

echo
echo "Pushed. The Space builds from the Dockerfile — several minutes the first"
echo "time. Watch it under the Space's Logs tab."
echo
echo "If you have not already, set two secrets under the Space's"
echo "Settings → Variables and secrets:"
echo "  DATABASE_URL   your Neon connection string"
echo "  APP_SECRET     openssl rand -base64 32"
