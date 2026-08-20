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
pnpm install && cp .env.example .env
createdb sanad_dev && pnpm db:migrate && pnpm db:seed:demo
pnpm dev     # then sign in with the account the seed prints
```

Running the demo in front of an audience: [docs/DEMO.md](docs/DEMO.md).

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
| [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md) | Every feature, verified against the code: implemented, partial, preview, or future |
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

Written to be checkable. Every "implemented" row below has a command that demonstrates it.

### Implemented and verified

| Capability | How to verify |
|---|---|
| Email/password accounts, Argon2id, opaque server sessions, email-verification tokens (generated and stored hashed; delivery is not wired) | `pnpm test` — `auth.test.ts`, `security.test.ts` |
| CSRF double-submit, Postgres fixed-window rate limiting | `security.test.ts` (20 tests) |
| Student-created, student-owned courses in any discipline | `courses.test.ts` |
| Lectures, resumable and idempotent uploads, checksum verification | `content.test.ts` |
| Transcripts with per-segment timestamps, language and code-switch detection, confidence bands | `rag.test.ts` |
| Instructor-emphasis detection from the professor's own phrasing | `rag.test.ts`, and Beat 2 of the demo |
| PDF and text extraction with page and character anchors | `content.test.ts` |
| Hybrid search across transcripts and documents, with deep links | `rag.test.ts`, `/api/v1/search` |
| Grounded answering with validated citations, and **refusal below a confidence threshold** | `rag.test.ts`, Beat 5 of the demo |
| Exam Mode: summary, key terms, flashcards, questions — every item sourced | `exam.test.ts` (20 tests) |
| Mastery tracking, with confidence held separately from score | `exam.test.ts` |
| Deterministic study planning, no double-booking (enforced by an EXCLUDE constraint) | `coach.test.ts` |
| Offline recording queue: resume by byte offset, no duplicate on retry, survives app restart | `offline-queue.test.ts` (29 tests) |
| Streaming SHA-256 on device, matching the server's digest | `offline-queue.test.ts`, checked against `node:crypto` |
| One student cannot reach another's courses, recordings, materials, search or AI context | `isolation.test.ts` (21 tests) and `pnpm verify:isolation <url>` (15 checks, live) |
| Course-agnostic: no subject term in application code | `pnpm check:course-agnostic` (fails CI) — it has caught two real leaks so far |
| Student profile: university, faculty, department, academic year | `profile.test.ts` (17) |
| Course archiving and folders | `organization.test.ts` (11) |
| DOCX and **slide-anchored** PPTX ingestion | `office.test.ts` (15) |
| Schedule integration: university, work, gym, commitments, exam dates | `coach.test.ts`, and the seeded week produces **zero Monday sessions** against a shift |
| The interactive UI actually works after hydration | `pnpm verify:ui <url>` — 25 checks in a real browser |
| The Expo app compiles and bundles | `cd apps/mobile && pnpm exec tsc --noEmit && pnpm exec expo export --platform android` |

272 TypeScript tests, 55 Python tests, a clean typecheck and a clean production build.

Feature-by-feature detail, including what is *not* built: **[docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md)**.

### Implemented but not guaranteed

| Thing | What is true | What is not |
|---|---|---|
| **The mobile app** | 15 screens, typechecks against real Expo and React Native types, bundles to a 2.65 MB Hermes bundle; its queue logic is covered by 29 Node tests | **It has not been run on a physical device or simulator.** Permissions, audio capture, and background behaviour are unverified in practice |
| **Real speech recognition** | `WhisperCppProvider` spawns a real binary and detects its own availability | It has not been run against real lecture audio here, and `whisper-cli` is not installed in this environment |
| **Answer quality** | Extractive answers cannot state something the source does not say | They are quotations, not prose. They will read as quotations |
| **Arabic handling** | Normalization is shared by the TypeScript and Python code paths and checked against the same vectors | Dialect coverage has not been measured on real audio |
| **Study-content language** | Arabic, English and Chinese can be selected, and the UI says content stays in the language of the lecture | **Nothing is translated.** The provider throws rather than passing text through, so no path can claim a translation that did not happen |

### Not implemented

| Thing | Why |
|---|---|
| **A chosen ASR engine** | The benchmark has no audio to run on. **Benchmark pending real audio** — no engine measured, no winner chosen. [ASR_BENCHMARK.md](ASR_BENCHMARK.md) §10 |
| **Live transcription** | Deliberate. A live tier has to clear a real-time factor nobody has measured. [docs/LIVE_TRANSCRIPTION_DECISION.md](docs/LIVE_TRANSCRIPTION_DECISION.md) |
| **Translation generation** | Language *selection* is built and honest about its limits; no translation model runs at $0 for Arabic↔English↔Chinese technical text. Translating an extracted quotation would also break the link between a sentence and its timestamp |
| **AI Voice Tutor** | Preview only. It must route through the same retrieval and refusal as Ask Sanad when built — voice is an input shell, never a second answering engine |
| **YouTube URL import** | Preview only. Uploading a video file works; importing from a URL needs reliable audio extraction and a licence position |
| **Sanad Community** | Preview only. A social layer needs moderation, abuse handling and a privacy review before it touches student work |
| **Professor and TA portals, community features, AI whiteboard, gamification** | Out of scope until the core is stable. [MVP.md](MVP.md) |
| **OCR for scanned PDFs** | A scanned PDF is reported as such, with a message the student can act on, rather than silently producing nothing |
| **S3-compatible object storage** | `StorageProvider` exists so this is a provider swap rather than a rewrite, but only `LocalDiskStorage` is implemented |
| **Email delivery** | Verification tokens are generated and stored hashed; no mail transport is wired |

### Not deployed

This runs on a laptop against a local PostgreSQL. It has not been deployed publicly, and the security work that must precede that — HTTPS termination, real secret management, mail delivery, backup and retention enforcement — is listed in [ARCHITECTURE.md](ARCHITECTURE.md) §11.

## الخلاصة بالعربي

- **سند مش شات بوت.** الأساس هو قاعدة بيانات أكاديمية منظمة — نصوص المحاضرات، المواد، التوقيتات، الاسترجاع، والمصادر — والـ AI مكوّن واحد فوقها، مش النظام كله.
- **أي إجابة لازم يكون ليها مصدر** بالتوقيت أو رقم الصفحة، ولو المعلومة مش موجودة في مواد الطالب، سند يقول "مش لاقيها" بدل ما يخترع. ده متطبّق في قاعدة البيانات وفي الكود، مش مجرد تعليمات للموديل.
- **النظام يشتغل مع أي مادة.** مفيش أي مادة أو مصطلح أو موضوع مكتوب جوه الكود — كله بيانات قابلة للتعديل، وفيه فحص في الـ CI بيكسر الـ build لو أي مصطلح خاص بمادة معينة اتسرّب للكود.
- **الخطوة الأولى** هي تقييم دقة التفريغ الصوتي على تسجيلات حقيقية قبل بناء أي حاجة تانية، لأن كل حاجة في المنتج بتعتمد عليه.

التفاصيل الكاملة في المستندات فوق.
