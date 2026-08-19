# MVP.md

Scope, phases, and the demo narrative.

**Status:** decisions finalized. **Phase 1 complete**; Phases 2–11 not started.

---

## 1. What the MVP is

Sixteen capabilities forming **one connected system**, not sixteen features sharing a login:

| # | Capability | Depends on |
|---|---|---|
| 1 | Live lecture transcription | — |
| 2 | Arabic/English code-switching | 1 |
| 3 | Technical term correction | 1, course vocabulary |
| 4 | Automatic lecture archive | 1 |
| 5 | Multi-format material ingestion | — |
| 6 | Unified smart search | 4, 5 |
| 7 | Grounded Q&A with citations | 6 |
| 8 | Automatic summaries | 4 |
| 9 | Flashcards and quizzes | 8, topics |
| 10 | Exam Mode | 8, 9, 11 |
| 11 | Professor-emphasis detection | 1 |
| 12 | AI study coach | 13, exam dates |
| 13 | Structured learning memory | 9 |
| 14 | On-demand transcript translation | 1 |
| 15 | Offline lecture recording and sync | 1 |
| 16 | Offline access to downloaded content | 4, 5, 8, 9 |

The dependency column is the argument for the ordering in §4: nothing can be built before what it reads from exists.

Capabilities 14–16 came from the final decision round. **15 is not a convenience feature** — university connectivity is unreliable and a lecture happens once, so recording that depends on a network is recording that sometimes loses the lecture entirely.

### The one-sentence product

**Sanad supports a student before the lecture, during it, after it, through daily study, and into the exam** — operating on that student's actual academic materials, with every claim traceable to a source.

---

## 2. Explicitly out of scope

Deferred (§23 of the brief) — architected for, not built:

student community · TA dashboard · instructor dashboard · AI-generated FAQ · voice chat · AI whiteboard · professor upload portal · gamification · institutional analytics · AI video or avatar tutor · university-wide course provisioning

**Why these are deferred**, so the decision isn't reopened under deadline pressure: each either requires a user population that does not exist yet (community, FAQ, dashboards, analytics), or adds a delivery surface without adding a capability the system lacks (voice chat, avatar, whiteboard).

They are not casualties of the schedule; they are the second half of the story. Sanad begins with one student in one lecture and grows into an institutional academic layer. Presenting them that way is stronger than presenting a half-built version of any of them.

**Two items moved into scope** in the final decision round, and this document previously listed them here:

- **Translation** is now part of the MVP UI — Arabic, English, and Chinese, generated on demand for the language the student selects.
- **Offline** is now part of the MVP — recording without a network, and reading downloaded content without a network.

**What offline still does not mean.** No AI inference runs on the device. Recording and reading work offline; transcription, summarization, and generation happen when connectivity returns. That is how it is described everywhere, and Sanad will not claim otherwise.

Instructors and TAs have accounts and roles, but **no course-management permissions** — courses are student-owned. Their access becomes meaningful when the deferred community and instructor features arrive.

---

## 3. Course-agnostic acceptance test

The MVP is not complete until this passes:

> **Load a course from a completely different discipline — its materials, its vocabulary, its lectures — and run the entire demo narrative on it, with zero code changes and zero rebuilds.**

Concretely: two seeded courses from unrelated faculties, both fully functional. If any step requires touching application code, §32 has been violated and the build is not done.

CI enforces the mechanical half continuously: `scripts/check-course-agnostic.sh` fails the build if any demo course's vocabulary or topic names appear outside `seed/`, `fixtures/`, or test files ([ARCHITECTURE.md](ARCHITECTURE.md) §1.1).

---

## 4. Phases

Each phase has an exit criterion. A phase is not "done" because its code exists; it is done when the criterion is demonstrably met.

### Phase 0 — Architecture and ASR benchmark

Architecture documents (this set) reviewed and approved. Then the benchmark in [ASR_BENCHMARK.md](ASR_BENCHMARK.md) runs against ~30 minutes of real lecture audio.

**This phase gates everything.** Code-switched technical transcription is the load-bearing assumption of the product; if it fails, the approach changes, and that is far cheaper to discover now than in Phase 3.

The recurring ASR budget is **$0**, so candidates are open-source engines on CPU. That makes **real-time factor** a decision gate alongside accuracy: an engine slower than real time cannot drive a live transcript, however accurate it is. The response to each outcome is pre-committed in [ASR_BENCHMARK.md](ASR_BENCHMARK.md) §7 so results cannot be rationalized after the fact.

> **Exit:** an engine and configuration selected against measured thresholds on real audio from two unrelated disciplines, at $0, with the result and the decision recorded in `benchmarks/asr/DECISION.md`.

The harness is implemented and self-tested ([benchmarks/asr/](benchmarks/asr/README.md)); only the audio is outstanding.

### Phase 1 — Foundation ✅

Monorepo and TypeScript configuration. Postgres + pgvector. Drizzle schema and the first migration covering identity, academic structure, and courses. Environment configuration validated at boot. Email/password authentication over `auth_identities`, Argon2id, server sessions. Role model and the central permission layer. Student profiles with inline reference-data creation. Student-owned courses with create, list, update, and delete. Responsive application shell with RTL support. Tests for the database and authentication foundation.

No AI, no ingestion, no retrieval — those are later phases and depend on this one.

> **Exit:** a student registers, signs in, creates a course of any subject, and sees only their own; a non-owner cannot modify it; migrations run clean from an empty database; database and auth tests pass.

### Phase 1b — Authentication hardening

Required before any public deployment, and scheduled ahead of Phase 2 work that would build on the same auth surface:

- Rate limiting on `/auth/register` and `/auth/login`, per IP and per email
- CSRF tokens on state-changing requests (`SameSite=Lax` alone is not defence in depth)
- Email verification — `users.email_verified_at` exists and is currently never set

> **Exit:** brute-forcing a password is rate-limited, a cross-site POST is rejected, and an unverified account is visibly distinguishable from a verified one.

### Phase 2 — Lectures and materials

Planned in detail in [docs/PHASE2_PLAN.md](docs/PHASE2_PLAN.md).

Academic structure and course ownership land in Phase 1; this phase builds on them. Lectures. Object storage. Material upload, extraction for every listed type, `material_chunks`, the Python ingestion tier, and the job queue with visible status.

**The `content_chunks` schema and the citation contract freeze at the end of this phase** — everything downstream reads them, and late migrations over embedded content are expensive.

> **Exit:** two courses from different disciplines exist, with materials uploaded and extracted, entirely through the UI.

### Phase 3 — Transcript processing and offline capture

Live capture over WebSocket, VAD, windowed recognition against the hosted ASR provider, draft/final rendering, `transcript_segments` with immutable raw text, confidence bands, session lifecycle.

**Offline capture ships in this phase, not later.** Local recording to IndexedDB, the upload queue, resumable chunked uploads keyed by `client_ref`, duplicate prevention, visible sync states, and audio capture constraints with graceful fallback. Recording offline and recording live must produce the same archive entry.

> **Exit:** a real lecture recording produces a timestamped transcript with raw output retrievable and low-confidence spans marked — **and** a lecture recorded with networking disabled, then reconnected, arrives complete, is not duplicated by a retry, and resumes rather than restarting after an interrupted upload.

### Phase 4 — Vocabulary and term correction

`technical_terms`, `course_vocabulary`, the three-stage correction pipeline, `term_corrections` audit rows, vocabulary derivation from course materials, vocabulary management UI.

> **Exit:** a course with no vocabulary can bootstrap one from its own materials, and corrections measurably improve technical-term accuracy on the benchmark audio.

### Phase 4b — Transcript translation

On-demand per-lecture translation into the student's selected display language, cached in `transcript_translations`, with the source always preserved and the supported-language list held in configuration.

> **Exit:** a student switches an Arabic transcript to English and to Chinese; the source remains retrievable; a second request for the same language is served from cache.

### Phase 5 — Embeddings and unified search

Chunking for both sources, batched embedding with persisted model identity, HNSW and GIN indexes, hybrid retrieval with RRF, normalization shared by index and query, vocabulary expansion, search UI with deep links.

> **Exit:** a query in one language finds relevant content in the other, and every result resolves to a timestamp, page, or slide.

### Phase 6 — Grounded Q&A

Retrieval → gate → generate → validate citations → render. SSE streaming. Refusal path. Citation persistence and resolution. `<Sourced>` rendering primitive.

> **Exit:** every answer carries at least one validated citation; out-of-scope questions are refused with **zero** fabricated answers across the refusal test set.

### Phase 7 — Summaries, flashcards, quizzes

Lecture and course summaries, keyword and topic derivation, flashcard and question generation with mandatory source references, quiz attempts and grading.

> **Exit:** generated study content exists for both seeded courses, and no item lacks a resolvable source.

### Phase 8 — Emphasis detection and Exam Mode

`emphasis_cues` seeded per language, two-stage detection, `lecture_emphasis` records, exam generation with configurable emphasis and weak-topic weighting, exam-taking flow.

> **Exit:** a generated exam contains a question traceable to a real emphasized moment, and the UI can play that moment.

### Phase 9 — Learning memory and study coach

Mastery updates on every graded interaction, availability and commitment capture, exam dates, the deterministic scheduler, event-driven replanning, coach messaging.

> **Exit:** two students with different quiz histories and different calendars receive materially different plans; plans regenerate identically from their snapshots.

### Phase 10 — Offline content access

Offline manifest per course, client-side caching of transcripts, summaries, flashcards, questions, notes, materials, and lecture metadata. Explicit download-for-offline. Cache invalidation by content hash. Honest offline states — what is available, what needs a network.

> **Exit:** with networking disabled, a student opens a downloaded course and reads its transcripts, summaries, and flashcards, and runs a study session; AI chat states plainly that it needs a connection.

### Phase 11 — Testing, polish, demo

Integration and evaluation suites green, RTL and localization verified, accessibility pass, seed data complete for both courses, demo rehearsed end to end, fallback recording captured.

> **Exit:** the §5 narrative runs start to finish, twice, without intervention, including the offline capture beat.

---

## 5. Demo narrative

The 21 steps from the brief, mapped to the capability each exercises. Any course may be used; the seeded demo course is one example among the seeded set.

| # | Step | Exercises |
|---|---|---|
| 1 | Student opens Sanad | Auth, dashboard |
| 2 | Selects a course | Structure, enrollment |
| 3 | Instructor begins speaking | Live capture |
| 4 | Live transcription appears | 1 |
| 5 | Code-switching handled | 2 |
| 6 | Technical terms normalized | 3 |
| 7 | Exam-important statement detected | 11 |
| 8 | Lecture ends | Session lifecycle |
| 9 | Lecture archived automatically | 4 |
| 10 | Summary generated | 8 |
| 11 | Student searches a topic | 6 |
| 12 | Relevant lecture section found | 6, anchors |
| 13 | Student asks a question | 7 |
| 14 | Answer returned with citation | 7, validation |
| 15 | Student asks about uncovered material | — |
| 16 | **Sanad refuses instead of hallucinating** | Confidence gate |
| 17 | Student opens Exam Mode | 10 |
| 18 | Grounded practice exam generated | 10, source refs |
| 19 | Student answers questions | 9 |
| 20 | Topic mastery updates | 13 |
| 21 | Coach recommends the next session | 12 |

### The three beats that carry the demo

**Step 6 — a term correcting itself on screen.** Draft text resolving into a corrected technical term shows the pipeline working, live, in a way no slide can assert.

**Step 16 — the refusal.** Fifteen seconds, and it is the most persuasive moment available. Every observer has seen a chatbot answer confidently and wrongly. A system that declines when its sources don't cover the question is demonstrating the property that makes it usable during exam week. Never cut this step for time.

**Step 18 — an exam question traced to an emphasized moment.** Opening a generated question, showing the instructor's own words behind it, and playing those seconds of audio proves the loop closed: Sanad heard the lecture, understood what mattered, and built study material from it.

### Demo-day discipline

- **Rehearse from recorded audio.** Live microphones fail in noisy rooms; that is the most common way a working demo dies. Run the transcription beat from a file, and add a short genuinely-live segment only after the recorded version has already made the point.
- **Seed and verify the night before.** Nothing generates for the first time during the demo.
- **Capture a fallback recording** of the full narrative.
- **Pre-test every query, question, and citation click** on the morning of.
- **Two roles:** one presenter drives, one narrates.

---

## 6. Definition of done for the MVP

1. All thirteen capabilities work end to end for a single student.
2. The course-agnostic acceptance test (§3) passes on two unrelated disciplines.
2a. Courses are student-created and student-owned; no subject is enumerated server-side.
3. Zero fabricated answers across the refusal test set.
4. Zero unresolvable citations across the citation test set.
5. Zero generated study items without a source reference.
6. Raw transcripts remain retrievable for every processed lecture.
6a. A lecture recorded offline reaches the archive intact after reconnection, without duplication.
6b. Downloaded course content is readable with networking disabled.
7. The scheduler violates none of its guarantees under property testing.
8. Arabic RTL renders correctly, including mixed-script transcript segments.
9. Migrations run clean from an empty database; seeds load both demo courses.
10. The §5 narrative runs start to finish without intervention.

Items 3, 4, and 5 are release gates. They are the product's central claim, and a regression in any of them is not a quality dip — it is the claim failing.
