# MVP.md

Scope, phases, and the demo narrative.

**Status:** proposed, awaiting review.

---

## 1. What the MVP is

Thirteen capabilities forming **one connected system**, not thirteen features sharing a login:

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

The dependency column is the argument for the ordering in §4: nothing can be built before what it reads from exists.

### The one-sentence product

**Sanad supports a student before the lecture, during it, after it, through daily study, and into the exam** — operating on that student's actual academic materials, with every claim traceable to a source.

---

## 2. Explicitly out of scope

Deferred (§23 of the brief) — architected for, not built:

student community · TA dashboard · instructor dashboard · AI-generated FAQ · voice chat · AI whiteboard · advanced multilingual translation UI · professor upload portal · gamification · offline downloaded lectures · institutional analytics · AI video or avatar tutor

**Why these are deferred**, so the decision isn't reopened under deadline pressure: each either requires a user population that does not exist yet (community, FAQ, dashboards, analytics), or adds a delivery surface without adding a capability the system lacks (voice chat, avatar, whiteboard).

They are not casualties of the schedule; they are the second half of the story. Sanad begins with one student in one lecture and grows into an institutional academic layer. Presenting them that way is stronger than presenting a half-built version of any of them.

**Offline** stays out per §24. When it arrives, it will be described exactly as "downloaded lectures work offline" — transcripts, summaries, flashcards, local search — never as offline AI inference, which is not implemented and will not be claimed.

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

> **Exit:** an ASR engine and configuration selected against measured thresholds, with the result documented and the decision recorded.

### Phase 1 — Foundation

Monorepo, TypeScript config, Drizzle migrations, Postgres + pgvector running, authentication with all four roles, permission layer, CI including the course-agnostic check, structured logging, error handling, secrets validated at boot.

> **Exit:** a user of each role can sign in and reach an authorized empty state; migrations run clean from scratch.

### Phase 2 — Academic structure and materials

Universities → faculties → departments → courses → offerings → enrollment. Lectures. Material upload via presigned URLs, extraction for every listed type, `material_chunks`, job queue with visible status.

**The `content_chunks` schema and the citation contract freeze at the end of this phase** — everything downstream reads them, and late migrations over embedded content are expensive.

> **Exit:** two courses from different disciplines exist, with materials uploaded and extracted, entirely through the UI.

### Phase 3 — Transcript processing

Live capture over WebSocket, VAD, windowed recognition, draft/final rendering, `transcript_segments` with immutable raw text, confidence bands, session lifecycle, recording stored in object storage.

> **Exit:** a real lecture recording produces a timestamped transcript; raw output remains retrievable; low-confidence spans are marked.

### Phase 4 — Vocabulary and term correction

`technical_terms`, `course_vocabulary`, the three-stage correction pipeline, `term_corrections` audit rows, vocabulary derivation from course materials, vocabulary management UI.

> **Exit:** a course with no vocabulary can bootstrap one from its own materials, and corrections measurably improve technical-term accuracy on the benchmark audio.

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

### Phase 10 — Testing, polish, demo

Integration and evaluation suites green, RTL and localization verified, accessibility pass, seed data complete for both courses, demo rehearsed end to end, fallback recording captured.

> **Exit:** the §5 narrative runs start to finish, twice, without intervention.

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
3. Zero fabricated answers across the refusal test set.
4. Zero unresolvable citations across the citation test set.
5. Zero generated study items without a source reference.
6. Raw transcripts remain retrievable for every processed lecture.
7. The scheduler violates none of its guarantees under property testing.
8. Arabic RTL renders correctly, including mixed-script transcript segments.
9. Migrations run clean from an empty database; seeds load both demo courses.
10. The §5 narrative runs start to finish without intervention.

Items 3, 4, and 5 are release gates. They are the product's central claim, and a regression in any of them is not a quality dip — it is the claim failing.
