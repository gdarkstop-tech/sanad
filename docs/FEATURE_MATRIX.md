# Feature matrix

Every feature discussed for Sanad, categorised by what the **code actually does** — not by what a document claims. Each row was checked against the repository: the service function, the route file, the table, the screen, the test.

**Legend for status**

| Status | Meaning |
|---|---|
| **Implemented** | Works end to end and has a test or a reproducible command |
| **Partial** | Real code exists, but a named part is missing or unverified |
| **UI only** | A surface exists and is honestly labelled *Coming Soon*; no backend, no fake requests |
| **Not built** | Nothing exists beyond, at most, a schema column |

Counts are at the end.

---

## A. CORE — must work for the competition

### A1. Email/password authentication

| | |
|---|---|
| **User value** | A private account. Nobody else can read this student's lectures. |
| **Status** | **Implemented** |
| **Files** | `packages/core/src/services/auth.ts`, `password.ts`, `session.ts` |
| **Endpoints** | `POST /api/v1/auth/register`, `/login`, `/logout`, `GET /api/v1/auth/me` |
| **Tables** | `users`, `auth_identities`, `sessions` |
| **Mobile** | Yes — `app/sign-in.tsx`, `app/register.tsx` |
| **Web** | Yes — `/sign-in`, `/register` |
| **Tests** | `auth.test.ts` (18) |
| **Priority** | Critical |
| **Remaining** | None. Google/Apple are values in the `auth_provider` enum only — deliberately not wired (see D3). |

### A2. Session, CSRF, rate limiting

| | |
|---|---|
| **User value** | The account stays the student's even on a shared network. |
| **Status** | **Implemented** |
| **Files** | `session.ts` (opaque token, SHA-256 at rest), `csrf.ts` (double-submit), `rate-limit.ts` (Postgres fixed window, no Redis), `apps/web/middleware.ts` |
| **Tables** | `sessions`, `rate_limit_buckets` |
| **Tests** | `security.test.ts` (20) |
| **Priority** | Critical |
| **Remaining** | None for the demo. Production still needs HTTPS termination and real secret management. |

### A3. Email verification

| | |
|---|---|
| **Status** | **Partial** — tokens work, delivery does not |
| **Files** | `packages/core/src/services/verification.ts` |
| **Endpoints** | `POST /api/v1/auth/verify-email`, `/resend-verification` |
| **Tables** | `email_verification_tokens` (stores only the hash) |
| **Tests** | `security.test.ts` — issue, verify, replay, expiry, unknown token, cascade on user delete |
| **Remaining** | No mail transport is wired. The token is returned by the API in this build so the flow is demonstrable. **Must not ship publicly without SMTP.** |

### A4. Student profile

| | |
|---|---|
| **User value** | Sanad knows which university, faculty, department and year the student is in. |
| **Status** | **Implemented** (this pass) |
| **Files** | `packages/core/src/services/auth.ts` → `readProfile`, `updateStudentProfile`; `apps/web/app/(app)/profile/page.tsx`; `apps/mobile/app/(tabs)/profile.tsx` |
| **Endpoints** | `GET`/`PATCH /api/v1/me/profile` |
| **Tables** | `student_profiles` (university, faculty, department, academic year, major, student number), `users` (name, email, locale, timezone) |
| **Mobile** | Yes | 
| **Web** | Yes |
| **Tests** | `profile.test.ts` |
| **Remaining** | None. |

### A5. Courses — student-created, student-owned, course-agnostic

| | |
|---|---|
| **User value** | Any subject, any faculty. Digital Logic, Chemistry, Chinese — the student types it. |
| **Status** | **Implemented** |
| **Files** | `packages/core/src/services/courses.ts` |
| **Endpoints** | `GET`/`POST /api/v1/courses`, `GET`/`PATCH`/`DELETE /api/v1/courses/{id}` |
| **Tables** | `courses`, `course_offerings`, `course_enrollments`, `course_staff` |
| **Mobile** | Yes — list, create, open |
| **Web** | Yes |
| **Tests** | `courses.test.ts` (11), plus `pnpm check:course-agnostic` fails CI if a subject term reaches code |
| **Remaining** | None. Demo courses are seed fixtures; no subject exists in application code. |

### A6. Course archive

| | |
|---|---|
| **User value** | Last semester's courses stop cluttering the list without being destroyed. |
| **Status** | **Implemented** (this pass) |
| **Files** | `courses.ts` → `setCourseArchived`; migration `0005_phase8_organization.sql` |
| **Endpoints** | `POST /api/v1/courses/{id}/archive` |
| **Tables** | `course_offerings.archived_at` |
| **Tests** | `organization.test.ts` |
| **Remaining** | None. |

### A7. Lectures

| | |
|---|---|
| **Status** | **Implemented** |
| **Files** | `packages/core/src/services/lectures.ts` |
| **Endpoints** | `GET`/`POST /api/v1/courses/{id}/lectures`, `GET`/`DELETE /api/v1/lectures/{id}`, `POST /api/v1/lectures/{id}/sessions` |
| **Tables** | `lectures`, `lecture_sessions` |
| **Mobile** | Yes | **Web** | Yes |
| **Tests** | `content.test.ts` |
| **Remaining** | None. Create, name, record, upload, view, archive, soft-delete all present. |

### A8. Offline lecture recording

| | |
|---|---|
| **User value** | The signature feature. A lecture happens once; a basement has no signal. |
| **Status** | **Partial** — logic implemented and tested; **not run on a physical device** |
| **Files** | `packages/offline/src/{types,queue,cache,sha256,testing}.ts`, `apps/mobile/lib/{adapters,queue,api}.ts`, `apps/mobile/app/course/[id]/record.tsx` |
| **Endpoints** | Reuses the existing `POST /api/v1/uploads`, `PUT /api/v1/uploads/{id}/chunk`, `POST /api/v1/uploads/{id}/complete`. **No second upload system.** |
| **Tables** | `upload_sessions`, `materials` |
| **Mobile** | Yes | **Web** | No — recording is a mobile capability |
| **Tests** | `offline-queue.test.ts` (29): no-network capture, resume by byte offset, offset resynchronisation, capped backoff then visible failure, no duplicate on replay, app-restart recovery, corrupted-entry tolerance, original preserved until confirmed, streaming SHA-256 vs `node:crypto` |
| **Remaining** | Device verification. Audio capture, permissions and background behaviour are unverified in practice. |

### A9. Resumable, idempotent upload

| | |
|---|---|
| **Status** | **Implemented** |
| **Files** | `packages/core/src/services/materials.ts` |
| **Tables** | `upload_sessions` (unique on `client_ref`) |
| **Tests** | `content.test.ts` — chunked completion, resume from offset, wrong-offset rejection, replayed `clientRef` resumes rather than duplicating, corrupted upload fails, partial completion refused, overrun rejected, cross-student write refused |
| **Remaining** | None. |

### A10. Transcription

| | |
|---|---|
| **Status** | **Partial** — pipeline implemented; no engine chosen |
| **Files** | `packages/core/src/asr/index.ts` (`AsrProvider`, `FixtureAsrProvider`, `WhisperCppProvider`), `services/pipeline.ts` |
| **Tables** | `transcript_segments`, `lecture_sessions` |
| **Tests** | `rag.test.ts` — determinism, ordered non-overlapping timestamps, code-switching preserved, provider recorded on the session |
| **Remaining** | **Benchmark pending real audio** — no engine measured, no winner chosen (`ASR_BENCHMARK.md` §10). `whisper-cli` is not installed here. |

### A11. Arabic/English code-switching

| | |
|---|---|
| **Status** | **Implemented** |
| **Files** | `asr/index.ts` → `detectSegmentLanguage`, `packages/core/src/text.ts` → `normalizeArabic` |
| **Tables** | `transcript_segments.primary_language`, `is_code_switched` |
| **Tests** | `rag.test.ts`, `core.test.ts`, and `shared/text-normalization-vectors.json` run by both the TypeScript and Python normalisers |
| **Remaining** | Dialect coverage unmeasured until real audio exists. RTL rendering not reviewed on a device. |

### A12. Instructor-emphasis detection

| | |
|---|---|
| **User value** | "This is important for the exam" becomes a bookmark. |
| **Status** | **Implemented** |
| **Files** | `services/pipeline.ts` → `detectEmphasis`, `seedEmphasisCues` |
| **Tables** | `emphasis_cues` (phrases are data, not code), `lecture_emphasis` |
| **Tests** | `rag.test.ts` — flags with the instructor's own words and a timestamp |
| **Remaining** | None. |

### A13. Material ingestion — PDF and text

| | |
|---|---|
| **Status** | **Implemented** |
| **Files** | `packages/core/src/ingestion/extract.ts` (`pdfExtractor` via unpdf, `textExtractor`) |
| **Tables** | `materials`, `material_chunks` |
| **Tests** | `content.test.ts` — page-anchored PDF chunks, char-anchored text, scanned PDF reported with an actionable message, image kept usable without pretending extraction worked |
| **Remaining** | None. OCR is future work (D5). |

### A14. Unified search

| | |
|---|---|
| **Status** | **Implemented** |
| **Files** | `services/retrieval.ts` — lexical `to_tsquery` OR + pgvector cosine, fused with reciprocal rank |
| **Endpoints** | `GET /api/v1/search?q=&course_id=` |
| **Tables** | `content_chunks` (HNSW + GIN indexes) |
| **Mobile** | Yes | **Web** | Yes |
| **Tests** | `rag.test.ts` — across transcript and PDF, deep link per result, empty query returns nothing, never another student's content |
| **Remaining** | None. |

### A15. Ask Sanad — grounded Q&A

| | |
|---|---|
| **Status** | **Implemented** |
| **Files** | `services/ask.ts` (`ExtractiveComposer`), `services/retrieval.ts` |
| **Endpoints** | `POST /api/v1/ask` |
| **Tables** | `qa_messages`, `citations` |
| **Tests** | `rag.test.ts` — validated citations, retrieved set recorded for audit |
| **Remaining** | None. Answers read as quotations, by design: an extractive composer cannot state what the source does not. |

### A16. Citations

| | |
|---|---|
| **Status** | **Implemented** |
| **Files** | `retrieval.ts` → `citationLabel`, `deepLinkFor` |
| **Tables** | `citations`; `content_chunks_anchor_ck` makes an unanchored chunk **unstorable** |
| **Tests** | `rag.test.ts` — every result carries a resolvable label and deep link |
| **Remaining** | None. |

### A17. Refusal below the retrieval threshold

| | |
|---|---|
| **User value** | The most important behaviour in the product. |
| **Status** | **Implemented** |
| **Files** | `services/ask.ts` — `RETRIEVAL_THRESHOLD`, dense-distance floor, distinctive-term evidence check |
| **Tests** | `rag.test.ts` — refusal persisted, generator recorded as `none` |
| **Remaining** | None. **The gate must not be weakened.** Below threshold the generator is never invoked — the API reports `generator: "none"`. |

### A18. Exam Mode

| | |
|---|---|
| **Status** | **Implemented** |
| **Files** | `services/exam.ts`, `services/study-content.ts` |
| **Endpoints** | `POST /api/v1/courses/{id}/exam` |
| **Tables** | `exams`, `exam_items`, `summaries`, `keywords`, `flashcards`, `questions`, `question_options` |
| **Mobile** | Yes | **Web** | Yes |
| **Tests** | `exam.test.ts` (20) — every item sourced, no duplicate sentences, filler cannot win a cloze blank, refuses another student's course |
| **Remaining** | None. |

### A19. Flashcards

| | |
|---|---|
| **Status** | **Implemented** |
| **Files** | `study-content.ts` → `ClozeFlashcardGenerator` |
| **Tables** | `flashcards` — `source_chunk_id` is `NOT NULL` |
| **Offline** | Yes — cached by `ContentCache` |
| **Tests** | `exam.test.ts` — sourced, deduplicated, blanks a term the source contains |
| **Remaining** | None. |

### A20. Study Coach — deterministic scheduling

| | |
|---|---|
| **Status** | **Implemented** |
| **Files** | `services/coach.ts` — `freeIntervals`, `priorityFor`, `generatePlan` |
| **Tables** | `study_availability`, `student_commitments`, `course_exams`, `study_plans`, `study_sessions` |
| **Tests** | `coach.test.ts` (18) — inside declared free time, never double-books (also enforced by a database `EXCLUDE` constraint), respects the daily cap, never after an exam, deterministic, supersedes rather than duplicating |
| **Remaining** | None in the engine. The *input* surface was the gap — see A21. |

### A21. Schedule integration — university, work, gym, commitments

| | |
|---|---|
| **User value** | A plan that ignores a Monday shift is not a plan. |
| **Status** | **Implemented** (this pass) |
| **Files** | `apps/web/components/ScheduleEditor.tsx`, `apps/mobile/app/(tabs)/coach.tsx`, `services/coach.ts` → `readAvailability`, `listCommitments`, `addCommitment`, `removeCommitment` |
| **Endpoints** | `GET`/`PUT /api/v1/me/availability`, `GET`/`POST /api/v1/me/commitments`, `DELETE /api/v1/me/commitments/{id}`, `GET`/`POST /api/v1/courses/{id}/exam-dates` |
| **Tables** | `study_availability` (`kind`: study \| work \| gym \| class \| sleep \| other), `student_commitments` |
| **Tests** | `coach.test.ts` — blocked windows and one-off commitments are both subtracted |
| **Remaining** | None. Recurring commitments are weekly windows; one-off commitments are dated. |

### A22. Academic memory / mastery

| | |
|---|---|
| **Status** | **Implemented** |
| **Files** | `services/mastery.ts` — accuracy × recency decay, **confidence tracked separately from score** so thin evidence never brands a topic weak |
| **Tables** | `quiz_attempts`, `attempt_answers`, `student_topic_mastery`, `study_topics`, `topic_links` |
| **Tests** | `exam.test.ts` |
| **Remaining** | None. |

### A23. Cross-student isolation

| | |
|---|---|
| **Status** | **Implemented** |
| **Files** | `packages/core/src/permissions.ts`; the permission filter lives inside the retrieval query itself |
| **Tests** | `isolation.test.ts` (21) plus `pnpm verify:isolation <url>` — 15 live HTTP checks |
| **Remaining** | None. Refusals return 404, not 403: existence is not leaked. |

### A24. Offline content access

| | |
|---|---|
| **Status** | **Partial** — implemented and tested; not device-verified |
| **Files** | `packages/offline/src/cache.ts`, mobile course/lecture/exam screens |
| **Cached** | Course metadata, lecture metadata, transcripts, emphasis, summary, flashcards, material list |
| **Tests** | `offline-queue.test.ts` — reads back with no network, corrupted entry discarded, refuses to download without a connection and says why |
| **Remaining** | Device verification. AI *generation* still needs connectivity, and the UI says so. |

---

## B. HIGH PRIORITY — implemented this pass

### B1. Folders / organisation

| | |
|---|---|
| **User value** | "Week 1", "Revision", "Semester 2" without building a filesystem. |
| **Status** | **Implemented** |
| **Files** | migration `0005_phase8_organization.sql`, `lectures.ts`, `materials.ts` |
| **Endpoints** | `PATCH /api/v1/lectures/{id}`, `PATCH /api/v1/materials/{id}`, `GET /api/v1/courses/{id}/folders` |
| **Tables** | `lectures.folder`, `materials.folder` — a nullable text label, deliberately not a tree |
| **Web** | Yes — lectures group by folder | **Mobile** | Yes — folder shown per lecture |
| **Tests** | `organization.test.ts` |
| **Remaining** | Nesting is out of scope on purpose. |

### B2. DOCX and PPTX ingestion

| | |
|---|---|
| **User value** | Slide decks are what most courses actually distribute. |
| **Status** | **Implemented** |
| **Files** | `packages/core/src/ingestion/office.ts`, wired in `extract.ts` |
| **Anchors** | PPTX → **`slideNo`** (one unit per slide). DOCX → `charStart`/`charEnd` per paragraph block. |
| **Tests** | `office.test.ts` — real generated files, slide numbering, encrypted/legacy formats rejected with an actionable message |
| **Remaining** | Legacy binary `.doc`/`.ppt` are refused, not silently mangled. |

### B3. Study-content language selection

| | |
|---|---|
| **Status** | **Partial — selection implemented, translation not built** |
| **Files** | `apps/web/components/ExamMode.tsx`, `apps/mobile/app/course/[id]/exam.tsx`, `packages/core/src/services/language.ts` |
| **Tables** | `course_offerings.primary_language`, `secondary_languages`; `content_chunks.language`; `transcript_segments.primary_language` |
| **Remaining** | The UI lets a student pick Arabic, English or Chinese and **says plainly** that generated study content is produced in the source language, because no translation model runs at $0 here. Source anchors are unaffected: nothing is translated, so nothing can be detached from its citation. |

---

## C. COMING SOON — UI preview only, honestly labelled

No fake network requests. No fabricated processing. Each surface states what it will do and that it is not available yet.

### C1. YouTube / external video import

| | |
|---|---|
| **Status** | **UI only** |
| **Files** | `apps/web/components/ComingSoon.tsx`, `apps/web/app/(app)/courses/[courseId]/page.tsx` |
| **Copy** | "Add a lecture video or YouTube source and Sanad will turn it into searchable study material." |
| **Why not now** | A scraper built for a demo breaks the week after. Terms-of-service and audio extraction both need real work. |
| **Note** | Direct **video file upload** already works — the file is stored, and transcription runs when an engine is configured. Only URL import is deferred. |

### C2. AI Voice Tutor

| | |
|---|---|
| **Status** | **UI only** |
| **Copy** | "Ask Sanad about your lectures using your voice." |
| **Why not now** | Speech-to-speech at $0 needs a local STT and TTS pair that has not been benchmarked. **No paid cloud dependency will be added for it.** |
| **Architecture** | When built it must route through the same `ask()` path — same retrieval, same citations, same refusal gate. Voice is an input and output shell, never a second answering engine. |

### C3. Sanad Community

| | |
|---|---|
| **Status** | **UI only** |
| **Files** | `apps/web/app/(app)/community/page.tsx`, `apps/mobile/app/(tabs)/community.tsx` |
| **Copy** | "Ask, discuss, and learn with your university community." |
| **Preview shows** | Posts, questions, TA answers, an AI reply clearly badged as AI — all static, deterministic sample content, visibly labelled as a preview |
| **Why not now** | A social backend means moderation, abuse handling and privacy review. That is not a week of work, and shipping it half-done would be worse than not shipping it. |

### C4. Course activity preview

| | |
|---|---|
| **Status** | **UI only**, on real data where it exists |
| **Files** | `apps/web/components/CourseActivity.tsx` |
| **Note** | Recent lecture, next exam and last study activity are **real** — they come from tables that already exist. Announcements and discussion are labelled as preview. |

---

## D. FUTURE — not implemented, deliberately

| # | Feature | Why not now |
|---|---|---|
| D1 | Professor / TA portals | `course_staff`, `instructor_profiles` and `teaching_assistant_profiles` exist; no UI. Out of scope until the student core is stable. |
| D2 | Live transcription | Decided against, with a written rationale — [LIVE_TRANSCRIPTION_DECISION.md](LIVE_TRANSCRIPTION_DECISION.md). Reversible only by a benchmark result that does not yet exist. |
| D3 | Google / Apple sign-in | `auth_identities` is built for it (provider + subject). Adds an external dependency and a consent surface for no competition value. |
| D4 | Full translation generation | Needs a translation model. Nothing at $0 has been evaluated for Arabic↔English↔Chinese technical text. |
| D5 | OCR for scanned PDFs | A scan is currently reported as such with an actionable message rather than silently yielding nothing. |
| D6 | AI whiteboard, gamification | Explicitly out of scope. |
| D7 | S3-compatible storage | `StorageProvider` exists so this is a provider swap. Only `LocalDiskStorage` is implemented. |
| D8 | Mail delivery | Tokens are generated and stored hashed; no SMTP transport. Blocks public deployment, not the demo. |

---

## Counts

| Category | Count |
|---|---|
| **Fully implemented** | **26** |
| **Partially implemented** | **6** — offline recording (not device-verified), offline content (not device-verified), transcription (no engine chosen), email verification (no delivery), language selection (no translation), Arabic handling (dialects unmeasured) |
| **UI only (Coming Soon)** | **4** |
| **Not implemented (future)** | **8** |

