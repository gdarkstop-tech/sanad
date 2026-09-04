# Sanad — AI Academic Companion

> **Sanad is not just an AI note-taking app. It is a complete AI academic companion that supports students from the moment a lecture starts until they finish their exams.**

> **سند ليس مجرد تطبيق لتفريغ المحاضرات. سند رفيق أكاديمي متكامل يرافق الطالب من لحظة بدء المحاضرة وحتى انتهاء الامتحان.**

**Current state: working MVP.** Accounts, courses, lectures, recordings, transcripts with
Arabic/English code-switching, materials, unified search, grounded Q&A with citations and
refusal, Exam Mode, academic memory, and a deterministic study coach — all running at **$0
recurring cost** on a laptop with no GPU.

What that does and does not include is set out in [Status](#status), below. It is written
plainly, including the parts that are not finished.

```bash
pnpm bootstrap   # installs, writes .env, checks the database, migrates, seeds
pnpm dev     # → http://localhost:3000, sign in with the account the seed prints
```

No PostgreSQL installed? `pnpm bootstrap:docker` starts one container and does the rest.
Nothing needs an account, an API key, or a paid service.

**Setting it up on a new machine, or running the demo:** start with
[docs/COMPETITION_READINESS.md](docs/COMPETITION_READINESS.md) — setup, reset,
troubleshooting, the demo sequence, and an honest account of what has and has not
been verified. Feature-by-feature detail is in
[docs/FINAL_FEATURE_MATRIX.md](docs/FINAL_FEATURE_MATRIX.md).

---

## The journey

**Before the lecture → during the lecture → after the lecture → daily studying → exam preparation.**

Sanad listens to a lecture, organizes it, makes it searchable, answers questions about it with citations, and turns it into study material and a study plan. It becomes the student's searchable academic memory.

## Two rules the whole system is built around

**1. Every claim is traceable.** Every answer, summary, flashcard, and exam question points back to a lecture timestamp or a document page. When the student's materials don't cover a question, Sanad says so instead of inventing an answer. This is enforced in the schema and in code, not requested in a prompt.

**2. Sanad is course-agnostic.** No subject, department, topic, or vocabulary exists in application code. Everything academic is configurable data. A Chemistry course, a Business course, and a Medicine course all load with zero code changes — and CI fails the build if a subject term leaks into application code.

Demo courses are seed fixtures and benchmark datasets. Nothing more.

## Architecture documents

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, technology decisions and their alternatives, module map, provider abstraction, auth, risks |
| [DATABASE.md](DATABASE.md) | Full PostgreSQL schema with DDL, pgvector strategy, indexes, migrations, sizing |
| [API.md](API.md) | REST endpoints, and the streaming contracts specified for later phases |
| [AI_PIPELINE.md](AI_PIPELINE.md) | ASR, term correction, retrieval, citation validation, emphasis detection, Exam Mode, deterministic scheduling |
| [MVP.md](MVP.md) | Scope, out-of-scope with reasons, phases 0–11 with exit criteria, demo narrative |
| [ASR_BENCHMARK.md](ASR_BENCHMARK.md) | Phase 0 evaluation protocol, metrics, decision thresholds |

Read them in that order. `ARCHITECTURE.md` §11 records the decisions taken and what remains open.

## Working documents

| Document | Contents |
|---|---|
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup, migrations, tests |
| [docs/COMPETITION_READINESS.md](docs/COMPETITION_READINESS.md) | Setup, reset, troubleshooting, the demo sequence, and what is and is not verified |
| [docs/FINAL_FEATURE_MATRIX.md](docs/FINAL_FEATURE_MATRIX.md) | Every feature with its status, what tested it, and whether it ran on a device |
| [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md) | The narrative version, with per-feature rationale |
| [docs/DEMO.md](docs/DEMO.md) | The competition demo: setup, reset, the beats, expected questions |
| [docs/LIVE_TRANSCRIPTION_DECISION.md](docs/LIVE_TRANSCRIPTION_DECISION.md) | Why there is no live transcription, and what would reverse that |
| [docs/PHASE2_PLAN.md](docs/PHASE2_PLAN.md) | Lectures, storage, upload, extraction (delivered) |
| [benchmarks/asr/README.md](benchmarks/asr/README.md) | Benchmark harness — implemented, awaiting audio |

## Technology

PostgreSQL 16 + pgvector as the single source of truth · Drizzle as the sole owner of the schema · TypeScript throughout: Next.js 15 for the web app, Expo / React Native for mobile, both against one backend · binaries on local disk behind a `StorageProvider` interface · a Postgres job queue rather than Redis · Python only for the ASR benchmark harness.

**Every AI capability runs at $0 with no GPU and no API key**, behind a provider interface:

| Capability | Implementation | Cost |
|---|---|---|
| Speech recognition | `AsrProvider` — fixture for development, `whisper.cpp` for a real binary | $0, local |
| Document extraction | unpdf for PDF, fflate for DOCX/PPTX — no converter binary, no service | $0, local |
| Embeddings | `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, int8 ONNX, 384-d, in process on CPU | $0, local |
| Retrieval | Postgres full-text OR `to_tsquery` + pgvector cosine, fused with reciprocal rank | $0 |
| Answers | Extractive composition from retrieved chunks — quotes, never paraphrase | $0, no LLM |
| Summaries, flashcards, questions | Deterministic extraction from the course's own content | $0, no LLM |
| Study plan | Deterministic scheduling, constraint-enforced in the database | $0, no LLM |

The interfaces exist so a local LLM can improve phrasing later without touching storage, citations, or the API. Nothing about the product depends on that happening.

Offline-first on mobile: recording a lecture never requires a network, and downloaded courses stay readable without one. The web app needs a connection.

Rationale, and what was rejected, in [ARCHITECTURE.md](ARCHITECTURE.md) §3.

---

## Status

Three categories, kept strictly separate. Full detail with per-feature test
evidence: **[docs/FINAL_FEATURE_MATRIX.md](docs/FINAL_FEATURE_MATRIX.md)**.

### Available Now

Genuinely implemented, with a test or a reproducible command behind each one.

| Capability | How to verify |
|---|---|
| Email/password accounts, Argon2id, opaque sessions, logout | `auth.test.ts` (18) |
| CSRF double-submit, Postgres rate limiting (no Redis) | `security.test.ts` (20) |
| Student profile — university, faculty, department, year, major | `profile.test.ts` (17) |
| Student-created courses in any discipline; rename, archive, restore, delete | `courses.test.ts`, `organization.test.ts` |
| Folders for lectures and materials | `organization.test.ts` (11) |
| Lectures, resumable and idempotent uploads, checksum verification | `content.test.ts` (22) |
| Offline recording queue — resume by offset, no duplicates, survives restart | `offline-queue.test.ts` (29) |
| PDF (page), PPTX (**slide**), DOCX (character), text ingestion | `content.test.ts`, `office.test.ts` (15) |
| Transcript timestamps, code-switching, confidence bands, emphasis | `rag.test.ts` (19) |
| **Transcript provenance disclosure** — placeholder text says so | `rag.test.ts`, browser |
| Hybrid search, per-course and across all courses | `rag.test.ts`, browser |
| Ask Sanad with validated citations | `rag.test.ts`, browser |
| **Refusal below threshold** — generator never invoked | `rag.test.ts`, browser |
| Exam Mode: summary, key terms, flashcards, sourced questions | `exam.test.ts` (20) |
| Mastery tracking, confidence separate from score | `exam.test.ts` |
| Study Coach around university, work, gym, commitments, exam dates | `coach.test.ts` (20) |
| Cross-student isolation on every surface | `isolation.test.ts` (21) + `pnpm verify:isolation` |
| Course-agnostic: no subject term in application code | `pnpm check:course-agnostic` |

### Coming Soon

A labelled preview surface exists. No backend, no fake requests, nothing that
behaves like a broken feature. Defined once in `@sanad/contracts/roadmap` and
rendered identically on web and mobile.

AI Voice Tutor · YouTube Import · Video Understanding · Community Feed ·
Instructor & TA Community · Live Translation · Smart Translation ·
Collaborative Study · AI Study Groups · Advanced OCR · Live Transcription

### Future

Not exposed in the app at all: professor and TA portals, Google/Apple sign-in,
S3-compatible storage, mail delivery, gamification, AI whiteboard.

### Counts

**52 implemented · 8 partial · 11 Coming Soon · 6 future** — counted from the
rows of the matrix, not estimated.

---

## Verification

Last run, in this repository, with output read:

```
pnpm test                 286 passed, 15 files
pnpm test:asr              55 passed
pnpm typecheck              0 errors
mobile tsc --noEmit         0 errors
pnpm build                  clean
expo export (android)       955 modules → 2.66 MB Hermes bundle
pnpm check:course-agnostic  OK, 25 seeded terms, none in code
pnpm verify:isolation      17/17 over HTTP
pnpm verify:demo           30/30 — every beat in DEMO.md
pnpm verify:ui             43/43 in Chromium, no console errors
pnpm bootstrap (fresh clone)    clean checkout → seeded demo
pnpm demo:reset             database rebuilt and reseeded
pnpm verify:all            10/10 in one run
```

Reproduce all of it:

```bash
pnpm verify:all http://localhost:3000
```

---

## Known Limitations

1. **Mobile runtime and microphone capture have not been physically verified.**
   No Android device was available. The app typechecks against real Expo types
   and bundles to Hermes, and the upload queue has 29 Node tests — but none of
   them involves a microphone, and nothing has rendered on a device.
2. **No ASR engine has been chosen, and none is installed here.** No lecture
   audio has been supplied to benchmark one ([ASR_BENCHMARK.md](ASR_BENCHMARK.md)
   §10), so **every transcript in this build is placeholder text**. The app says
   so on the lecture page, badges it in the archive, and warns on anything
   derived from it. Documents are read for real regardless.
3. **No translation.** Language selection works and states plainly that content
   stays in the language of the lecture. Nothing is translated.
4. **No live transcription**, deliberately —
   [docs/LIVE_TRANSCRIPTION_DECISION.md](docs/LIVE_TRANSCRIPTION_DECISION.md).
5. **Unsupported formats.** Legacy binary `.doc` and `.ppt` are refused with an
   actionable message rather than mangled. Scanned PDFs are reported as scans;
   OCR is Coming Soon. Images are stored but not read.
6. **Answers read as quotations, not prose.** That is what makes them incapable
   of stating something the source does not say.
7. **No mail delivery.** Verification tokens are generated and stored hashed; no
   SMTP transport is wired. Blocks public deployment, not the demo.
8. **Not deployed.** Runs on a laptop against local PostgreSQL.

## الخلاصة بالعربي

- **سند مش شات بوت.** الأساس هو قاعدة بيانات أكاديمية منظمة — نصوص المحاضرات، المواد، التوقيتات، الاسترجاع، والمصادر — والـ AI مكوّن واحد فوقها، مش النظام كله.
- **أي إجابة لازم يكون ليها مصدر** بالتوقيت أو رقم الصفحة، ولو المعلومة مش موجودة في مواد الطالب، سند يقول "مش لاقيها" بدل ما يخترع. ده متطبّق في قاعدة البيانات وفي الكود، مش مجرد تعليمات للموديل.
- **النظام يشتغل مع أي مادة.** مفيش أي مادة أو مصطلح أو موضوع مكتوب جوه الكود — كله بيانات قابلة للتعديل، وفيه فحص في الـ CI بيكسر الـ build لو أي مصطلح خاص بمادة معينة اتسرّب للكود.
- **الخطوة الأولى** هي تقييم دقة التفريغ الصوتي على تسجيلات حقيقية قبل بناء أي حاجة تانية، لأن كل حاجة في المنتج بتعتمد عليه.

التفاصيل الكاملة في المستندات فوق.
