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
pnpm bootstrap                    # does all of the below, and seeds a demo account
pnpm dev                      # http://localhost:3000
```

Or, by hand:

```bash
pnpm install
cp .env.example .env          # then edit it

createdb sanad_dev
createdb sanad_test

pnpm check:db                 # confirms the connection and pgvector
pnpm db:migrate               # applies migrations to DATABASE_URL
pnpm dev                      # http://localhost:3000
```

No local PostgreSQL? `pnpm bootstrap:docker` starts `pgvector/pgvector:pg16` in one
container and continues. It is the only container, and there is nothing paid in it.

### If Docker will not run — the third path

Docker needs hardware virtualisation and WSL 2. On some Windows laptops that
fails and is not quickly fixable, which is a bad thing to discover the night
before a deadline.

Sanad does not care *where* PostgreSQL is, only that it has `pgvector`. Any
reachable database works — including a free hosted one. There are **no code
changes**: point `DATABASE_URL` at it and run the same commands.

```bash
# .env
DATABASE_URL=postgres://user:password@host/dbname?sslmode=require

pnpm db:migrate      # creates the extensions and the schema
pnpm db:seed:demo    # the demo account
pnpm dev
```

The provider must allow `CREATE EXTENSION vector` and `CREATE EXTENSION
btree_gist` — the free tiers of the common hosted Postgres services do. No
paid plan is required, and the connection string is the only thing that
changes.

**Verified:** migrate and seed were run against a database the project did not
create, reached only by URL, with no code changes.

**The trade-off is real:** a hosted database needs working internet during the
demo. A local one cannot be broken by venue Wi-Fi. Prefer local; keep this in
reserve.

**One `.env` at the repository root serves every package.** Tools run from
different working directories — drizzle-kit from `packages/db`, vitest from the
root, Next from `apps/web` — so the file is located by walking up from the
module rather than trusting the current directory. Existing environment
variables always win over the file, so container and CI configuration is not
overridden.

`.env` is gitignored. `.env.example` documents every variable, including the
Phase 2+ ones that are listed but unused, so the shape is known in advance.

## Commands

> **Why `bootstrap` and not `setup`?** `pnpm setup` is a reserved pnpm command
> — it configures pnpm's own home directory and never reaches a package script,
> silently. Every project script name has to be one pnpm does not already own.
> `pnpm run setup` still works if you have older instructions.


| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm test` | Full suite (unit + integration) |
| `pnpm typecheck` | Whole workspace |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Seed emphasis cue phrases (required for emphasis detection) |
| `pnpm db:seed:demo` | Seed a full demo account: two unrelated courses, lectures with transcripts, PDFs, answer history, exam date and a study plan |
| `pnpm test:asr` | ASR benchmark harness tests |
| `pnpm check:course-agnostic` | Fail if a seeded subject term leaked into code |
| `pnpm verify:isolation <url>` | Probe cross-student isolation over HTTP against a running server |
| `pnpm verify:ui <url>` | Drive the real UI in Chromium — the only check that runs client components |
| `pnpm verify:demo <url>` | Check every beat in docs/DEMO.md against the running product |
| `pnpm bootstrap` | Clean checkout → installed, configured, migrated, seeded |
| `pnpm bootstrap:docker` | The same, starting PostgreSQL in a container first |
| `pnpm check:db` | Is PostgreSQL reachable, and does it have pgvector? |
| `pnpm demo:reset` | Rebuild and reseed the demo database (~30s) |
| `pnpm verify:all` | Everything checkable without a phone, in one run |
| `pnpm mobile` | Expo dev server |
| `pnpm mobile:apk` | Build an installable Android APK (needs the Android SDK) |

## The mobile app

`apps/mobile` is excluded from the root `tsconfig.json`: it needs Expo's own base
config and its own React types, and React Native pins `@types/react` 18 while the
web app is on 19. It is checked on its own.

```bash
cd apps/mobile
pnpm exec tsc --noEmit                  # typecheck against real Expo types
pnpm exec expo export --platform android  # proves it bundles
pnpm start                              # Expo dev server
```

No configuration step: on a device or emulator `localhost` means the device, so
the app derives the API host from the address Expo served the bundle from, which
is the machine running `pnpm dev`. An Android emulator's loopback is rewritten to
`10.0.2.2`. `EXPO_PUBLIC_SANAD_API_URL` overrides all of it for a deployed
backend; `lib/resolve-api-url.ts` holds the rules and
`tests/unit/mobile-api-url.test.ts` covers them.

If a phone on the same Wi-Fi still cannot connect, the host firewall is the usual
cause — Windows asks once whether Node may accept connections on private
networks, and a refused prompt is silent afterwards. The sign-in screen prints
the address it is calling, and lets you correct it, which is both the diagnosis
and the fix.

### An installable APK

Expo Go is the normal way to run this, and needs nothing below. Build an APK
when Expo Go cannot serve — handing someone a phone with Sanad already on it, or
an Expo Go release that has dropped this SDK.

```bash
pnpm mobile:apk                    # → sanad.apk, needs the Android SDK and a JDK
npx eas-cli build --platform android --profile preview   # or build in Expo's cloud
```

It is a release build: the JavaScript is bundled in, so it runs with no Metro and
no laptop attached. It still needs a Sanad server, and there is no Metro to ask
for the address — so the sign-in screen opens on the server field the first time,
and remembers what you type. Nothing is baked in at build time, which is what
lets one APK survive a new LAN address.

`apps/mobile/android/` is generated by `expo prebuild` and is not committed:
`app.json` is the only source of truth for the package name, permissions and
icons, and `scripts/build-apk.sh` regenerates the project with `--clean` so that
stays true. The icons themselves come from `scripts/make-app-icon.mjs` — Chromium
renders the SVG, so no image toolchain is needed.

Both build paths sign with a local debug key, which differs per machine. Android
refuses to replace an app with a differently-signed build, so uninstall an APK
built elsewhere before installing a new one.

Three things a native build needs that Expo Go does not:

- **`expo-asset` is a direct dependency.** It belongs to `expo` and pnpm does not
  hoist it, but Metro resolves it from the app's own `node_modules` when bundling
  for a release build. Without it the build fails at
  `createBundleReleaseJsAndAssets` with "The required package `expo-asset` cannot
  be found".
- **Cleartext HTTP is permitted**, via `plugins/with-lan-cleartext.js`. Android
  has blocked it by default since Android 9, and Expo's template re-enables it
  only for debug builds. Sanad talks to a server the student runs on their own
  network, where no certificate can be issued for `192.168.1.5` at $0. The plugin
  says the same thing at more length; it is a real widening and named as one.
- **Kotlin is pinned to 1.9.24**, via `plugins/with-kotlin-version.js`. React
  Native 0.76 puts that version on the classpath while Expo's template ext says
  1.9.25, and `expo-modules-core` picks its Compose compiler from the ext — so
  the two disagree and `:expo-modules-core:compileReleaseKotlin` fails. Expo Go
  never sees this, because nothing compiles there.

**It has not been run on a physical device.** It typechecks and bundles, and the
queue logic underneath it is covered by 29 Node tests, but audio capture,
permissions and background behaviour are unverified in practice.

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
apps/web          Next.js — web app and the REST API
apps/mobile       Expo / React Native — 16 screens against the same API
packages/db       Drizzle schema + migrations   ← sole schema owner
packages/core     Domain services: auth, courses, permissions, retrieval, text
                  ingestion/  PDF, text, DOCX, PPTX extractors
packages/contracts Zod schemas shared by every caller
packages/offline  Recording queue and content cache — platform-agnostic
seed/             Demo course fixtures (two unrelated disciplines)
scripts/          CI checks, seeds, the isolation probe
benchmarks/asr    ASR evaluation harness (Python)
tests/            Unit + integration
```

`packages/*` never import from `apps/*`. Domain rules stay testable without a
running server.

## What exists today

The full MVP loop: accounts and student-owned courses; lectures with recordings
transcribed through a provider-abstracted ASR layer; material upload with
resumable, idempotent uploads; extraction into page- and timestamp-anchored
chunks; hybrid search; grounded Q&A that cites its sources or refuses; Exam
Mode; academic memory; and a deterministic study coach.

**Everything runs at $0 recurring cost.** Embeddings are a small ONNX model in
process; ASR falls back to a fixture when whisper.cpp is not installed;
summaries, flashcards and questions are extractive and need no model at all.
Each sits behind a provider interface, so a local or paid model is an upgrade
rather than a dependency.

Client-side offline recording and the Expo app are now built too: recording
never needs a network, the queue resumes by byte offset and cannot create a
duplicate lecture, and downloaded courses stay readable offline.

**For what is and is not verified, read the [Status section of the
README](../README.md#status).** It is deliberately specific about the difference
between "tested" and "run on a phone".
