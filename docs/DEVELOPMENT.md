# Development

Setup, migrations, and tests for the Phase 1 foundation.

## Requirements

- Node 22+ and pnpm 10+
- PostgreSQL 16 with the `pgvector` extension

pgvector is enabled by the migration runner, but the extension must be
installed on the server first:

```bash
# Debian/Ubuntu
sudo apt-get install -y postgresql-16-pgvector
```

## Setup

```bash
pnpm install
cp .env.example .env          # then edit it

createdb sanad_dev
createdb sanad_test

pnpm db:migrate               # applies migrations to DATABASE_URL
pnpm dev                      # http://localhost:3000
```

**One `.env` at the repository root serves every package.** Tools run from
different working directories — drizzle-kit from `packages/db`, vitest from the
root, Next from `apps/web` — so the file is located by walking up from the
module rather than trusting the current directory. Existing environment
variables always win over the file, so container and CI configuration is not
overridden.

`.env` is gitignored. `.env.example` documents every variable, including the
Phase 2+ ones that are listed but unused, so the shape is known in advance.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm test` | Full suite (unit + integration) |
| `pnpm typecheck` | Whole workspace |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply migrations |
| `pnpm check:course-agnostic` | Fail if a seeded subject term leaked into code |

## Tests

Integration tests need a real PostgreSQL — they exercise constraints, checks,
and cascades, which is the point. Migrations are applied once to
`TEST_DATABASE_URL` before the suite; tables are truncated between tests rather
than re-migrated.

```bash
pnpm test                          # everything
pnpm exec vitest run tests/unit    # no database needed
```

Test files run serially: they share one database, and Argon2 is deliberately
CPU-expensive.

## Schema changes

Drizzle is the **sole owner** of the schema (ARCHITECTURE.md §3.3). Other
services may read and write these tables but must never define or alter them.

```bash
# 1. edit packages/db/src/schema/*.ts
pnpm db:generate     # writes a reviewable .sql file
# 2. read the generated SQL — it is the artifact under review, not the TS
pnpm db:migrate
```

Migrations are **forward-only**. A mistake is corrected by a new migration,
never by editing a released one.

## The course-agnostic check

`scripts/check-course-agnostic.sh` extracts every subject term used by demo
courses in `seed/demo-courses.json` — titles, vocabulary, aliases, topics — and
fails the build if any appears in `apps/` or `packages/`.

The denylist derives from seed data, so it grows automatically as demo courses
are added. If it fires, the fix is to move the value into seed data or a
configuration table — not to weaken the check. It has already caught one real
case: a subject name used as an example inside a code comment.

## Project layout

```
apps/web          Next.js — responsive PWA, REST API
packages/db       Drizzle schema + migrations   ← sole schema owner
packages/core     Domain services: auth, courses, permissions, text
packages/contracts Zod schemas shared by every caller
seed/             Demo course fixtures (two unrelated disciplines)
scripts/          CI checks
tests/            Unit + integration
```

`packages/*` never import from `apps/*`. Domain rules stay testable without a
running server.

## What exists today

Phase 1 only: accounts, sessions, profiles, and student-owned courses.
Lectures, materials, transcription, search, and everything AI arrive in later
phases — see [MVP.md](../MVP.md).
