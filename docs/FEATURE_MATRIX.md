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
| **Tests** | `profile.test.ts` (17) |
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
| **Tests** | `organization.test.ts` (11) |
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
| **Files** | `apps/web/components/ScheduleEditor.tsx`, `apps/web/app/(app)/plan/page.tsx`, `apps/mobile/app/(tabs)/coach.tsx`, `services/coach.ts` → `readAvailability`, `listCommitments`, `addCommitment`, `removeCommitment`, `listExamDates` |
| **Endpoints** | `GET`/`PUT /api/v1/me/availability`, `GET`/`POST /api/v1/me/commitments`, `DELETE /api/v1/me/commitments/{id}`, `GET`/`POST /api/v1/courses/{id}/exam-dates` |
| **Tables** | `study_availability` (`kind`: study \| work \| gym \| class \| sleep \| other), `student_commitments` |
| **Tests** | `coach.test.ts` (20) and `profile.test.ts`; demonstrated end to end by the seeded week — university Monday 09:00–15:00 plus work 16:00–21:00 produces **zero Monday sessions**, and a Wednesday gym window pushes study to 20:00 |
| **Remaining** | None. Recurring commitments are weekly windows; one-off commitments are dated. Both are subtracted before anything is scheduled. |

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
| **Tests** | `organization.test.ts` (11) |
| **Remaining** | Nesting is out of scope on purpose. |

### B2. DOCX and PPTX ingestion

| | |
|---|---|
| **User value** | Slide decks are what most courses actually distribute. |
| **Status** | **Implemented** |
| **Files** | `packages/core/src/ingestion/office.ts`, wired in `extract.ts` |
| **Anchors** | PPTX → **`slideNo`** (one unit per slide). DOCX → `charStart`/`charEnd` per paragraph block. |
| **Tests** | `office.test.ts` (15) — real generated files parsed by the real extractor, slide 10 ordered after slide 9, legacy `.doc` refused with an actionable message |
| **Remaining** | Legacy binary `.doc`/`.ppt` are refused, not silently mangled. |

### B3. Study-content language selection

| | |
|---|---|
| **Status** | **Partial — selection implemented, translation not built** |
| **Files** | `packages/core/src/services/language.ts`, `apps/web/components/ExamMode.tsx` |
| **Tables** | `course_offerings.primary_language`, `secondary_languages`; `content_chunks.language`; `transcript_segments.primary_language` |
| **Remaining** | The UI lets a student pick Arabic, English or Chinese and **says plainly** that content stays in the language of the lecture, because no translation model runs at $0 here. `UnavailableTranslationProvider` throws rather than returning text unchanged, so no path can silently claim a translation happened. Source anchors are unaffected: nothing is translated, so nothing can be detached from its citation. Verified in the browser — selecting Chinese renders the notice. |

---

### B4. Course activity summary

| | |
|---|---|
| **Status** | **Implemented** |
| **Files** | `apps/web/components/CourseActivity.tsx` |
| **Note** | Everything shown is **real**: the most recent lecture, the next exam and how many lectures are transcribed all come from tables that already exist. Where there is nothing to show it says so rather than filling the space with a placeholder. |

---

---

## C. COMING SOON — UI preview only, honestly labelled

No fake network requests. No fabricated processing. Each surface states what it will do and that it is not available yet.

### C1. YouTube / external video import

| | |
|---|---|
| **Status** | **UI only** |
| **Files** | `apps/web/components/ComingSoon.tsx`, `apps/web/app/(app)/courses/[courseId]/page.tsx`, `apps/mobile/components/ui.tsx` |
| **Copy** | "Add a lecture video or YouTube source and Sanad will turn it into searchable study material." |
| **Why not now** | A scraper built for a demo breaks the week after. Terms-of-service and audio extraction both need real work. |
| **Note** | Direct **video file upload** already works — the file is stored, and transcription runs when an engine is configured. Only URL import is deferred. |

### C2. AI Voice Tutor

| | |
|---|---|
| **Status** | **UI only** |
| **Files** | `apps/web/components/ComingSoon.tsx` → `RoadmapGrid`, shown on `/plan` |
| **Copy** | "Ask Sanad about your lectures using your voice." |
| **Why not now** | Speech-to-speech at $0 needs a local STT and TTS pair that has not been benchmarked. **No paid cloud dependency will be added for it.** |
| **Architecture** | When built it must route through the same `ask()` path — same retrieval, same citations, same refusal gate. Voice is an input and output shell, never a second answering engine. |

### C3. Sanad Community

| | |
|---|---|
| **Status** | **UI only** |
| **Files** | `apps/web/app/(app)/community/page.tsx`, `apps/mobile/app/(tabs)/community.tsx` (Community tab) |
| **Copy** | "Ask, discuss, and learn with your university community." |
| **Preview shows** | Posts, questions, TA answers, an AI reply clearly badged as AI — all static sample content written into the page, visibly labelled as a preview. Sample courses are named generically ("One of your courses") rather than by subject: naming a discipline would put a subject into application code, which CI rejects, and would imply content exists for it |
| **Why not now** | A social backend means moderation, abuse handling and privacy review. That is not a week of work, and shipping it half-done would be worse than not shipping it. |

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

## Summary table

| Feature | Status | Competition ready | Notes |
|---|---|---|---|
| Offline recording | Implemented | **Yes, with a caveat** | 29 tests: no-network capture, resume by byte offset, no duplicate on replay, app-restart recovery. **Not run on a physical device.** |
| Upload / resume | Implemented | Yes | Resumable and idempotent on `clientRef`; wrong offset rejected rather than corrupting; checksum verified server-side |
| Courses | Implemented | Yes | Student-created, student-owned, any subject. CI fails if a subject term reaches code |
| Course archive | Implemented | Yes | Reversible, separate from delete, keeps all content |
| Lecture archive | Implemented | Yes | Create, name, record, upload, transcript, timestamps, status, soft-delete |
| PDF ingestion | Implemented | Yes | Page-anchored. Scanned PDFs reported with an actionable message |
| DOCX ingestion | Implemented | Yes | Character-anchored; no page numbers claimed, because DOCX has none |
| PPTX ingestion | Implemented | Yes | **Slide-anchored** — a citation can say "slide 7" |
| Video ingestion | Partial | Yes, as upload | Video files upload and store; transcription runs when an ASR engine is configured |
| YouTube import | Coming Soon | Preview only | UI states what it will do and that it is not available. No scraper |
| Search | Implemented | Yes | Hybrid lexical + dense, RRF-fused, deep links to the second |
| Ask Sanad | Implemented | Yes | Extractive composition over retrieved chunks |
| Citations | Implemented | Yes | Validated against the retrieved set; unanchored chunks are unstorable |
| Refusal | Implemented | Yes | Generator not invoked below threshold — API reports `generator: "none"`. Verified in the browser |
| Flashcards | Implemented | Yes | Sourced, deduplicated, readable offline once downloaded |
| Exam Mode | Implemented | Yes | Summary, key terms, emphasis, flashcards, sourced questions |
| Study Coach | Implemented | Yes | Deterministic; no double-booking, enforced by a database `EXCLUDE` constraint |
| Schedule integration | Implemented | Yes | University, work, gym, sleep, one-off commitments, exam dates — all subtracted before scheduling |
| Student profile | Implemented | Yes | Name, email, university, faculty, department, academic year, major, student number |
| Folders | Implemented | Yes | One label on lectures and materials; grouped headings, not a tree |
| Voice Chat | Coming Soon | Preview only | Will route through the same retrieval and refusal. No paid dependency will be added for it |
| Translation | Partial | Yes, honestly | Language selection works; the UI says content stays in the lecture's language. Nothing claims a translation that did not happen |
| Community Feed | Coming Soon | Preview only | Static, inert, labelled. No social backend |
| Course activity | Implemented | Yes | Real data only — recent lecture, next exam, how much is transcribed. Says so when there is nothing to show |
| Mobile app | Implemented | **Yes, with a caveat** | 15 screens, typechecks and bundles (954 modules → 2.65 MB). **Not run on a physical device** |
| Cross-student isolation | Implemented | Yes | 21 tests plus 15 live HTTP checks |

## Counts

| Category | Count |
|---|---|
| **Fully implemented** | **23** |
| **Partially implemented** | **5** — offline recording and offline content (not device-verified), transcription (no engine chosen), email verification (no delivery), study-content language (selection only, no translation) |
| **UI only (Coming Soon)** | **3** — AI Voice Tutor, YouTube import, Sanad Community |
| **Not implemented (future)** | **8** — see section D |

Counted from the sections above, not estimated: 23 rows marked **Implemented**, 5 **Partial**, 3 **UI only**, 8 future.

## Verification

Everything above was run, in this order, against a clean database:

```
TypeScript tests        272 passed (15 files)
Python tests             55 passed
Root typecheck            0 errors
Mobile typecheck          0 errors
Production build          clean
Expo bundle               954 modules → 2.65 MB Hermes bundle
Course-agnostic check     OK (25 seeded terms, none in code)
Isolation over HTTP       15/15
Browser UI checks         25/25, no console errors
Clean migrate + seed      17 study sessions around a real week
```

New tests this pass: `office.test.ts` (15), `profile.test.ts` (17), `organization.test.ts` (11) — 43 in total, taking the suite from 229 to 272.

## Known limitations

1. **The mobile app has not run on a phone.** It typechecks against real Expo and React Native types and bundles to Hermes bytecode, and the queue underneath it has 29 Node tests — but audio capture, microphone permissions and background behaviour are unverified in practice.
2. **No ASR engine has been chosen.** The benchmark harness is complete and self-tested; no lecture audio has been supplied, so **no engine has been measured**. `whisper-cli` is not installed in this environment.
3. **Answers read as quotations, not prose.** That is what makes them incapable of stating something the source does not say. Worth setting as an expectation before a demo rather than discovering at the citation panel.
4. **No mail delivery.** Verification tokens are generated and stored hashed; no SMTP transport is wired. This blocks public deployment, not the demo.
5. **Arabic RTL has not been reviewed on a device.** Mixed-script segments store and serve correctly and are covered by tests; the visual rendering has not been checked by eye.
6. **Not deployed.** Runs on a laptop against local PostgreSQL. HTTPS termination, secret management, backups and retention enforcement all remain.
7. **Legacy `.doc` and `.ppt` are refused**, not converted. They are told what to do instead of being stored as binary noise.
