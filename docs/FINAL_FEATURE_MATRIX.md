# Final feature matrix

Every feature, checked against the code that implements it — not against documentation.

**Statuses**

- `IMPLEMENTED` — works end to end, has a test or a reproducible command
- `PARTIAL` — real code exists, a named part is missing or unverified
- `COMING SOON` — a labelled preview surface exists; no backend, no fake requests
- `FUTURE` — not exposed in the app at all

**"Mobile Tested" means a physical device.** Nowhere in this document does it say yes:

> **Mobile runtime and microphone capture have not been physically verified.**

No Android device was available — `adb` is not installed and there is no USB bus. Typechecking and Hermes bundling are recorded under "Tested", where they belong. See [COMPETITION_READINESS.md](COMPETITION_READINESS.md) §4.

---

## Accounts and identity

| Feature | Status | Tested | Mobile Tested | Demo Ready | Notes |
|---|---|---|---|---|---|
| Registration | `IMPLEMENTED` | `auth.test.ts` (18), browser | No | Yes | Argon2id; duplicate email rejected |
| Login | `IMPLEMENTED` | `auth.test.ts`, browser | No | Yes | Unknown email and wrong password give the same 401 |
| Logout | `IMPLEMENTED` | `auth.test.ts` | No | Yes | Session revoked server-side, not just cookie-cleared |
| Session persistence | `IMPLEMENTED` | `auth.test.ts` | No | Yes | Opaque token, SHA-256 at rest, TTL |
| Password security | `IMPLEMENTED` | `auth.test.ts`, `core.test.ts` | No | Yes | Argon2id, deliberately slow |
| CSRF protection | `IMPLEMENTED` | `security.test.ts` (20) | No | Yes | Double-submit cookie; header-less request rejected |
| Rate limiting | `IMPLEMENTED` | `security.test.ts` | No | Yes | Postgres fixed window, no Redis. Per-IP and per-email |
| Email verification | `PARTIAL` | `security.test.ts` | No | Yes | Tokens issued, hashed, replay/expiry rejected. **No mail transport wired** |
| Student profile | `IMPLEMENTED` | `profile.test.ts` (17), browser | No | Yes | Name, email, university, faculty, department, academic year, major, student number |

## Courses

| Feature | Status | Tested | Mobile Tested | Demo Ready | Notes |
|---|---|---|---|---|---|
| Create course | `IMPLEMENTED` | `courses.test.ts` (11), browser | No | Yes | Any subject the student types |
| Rename / edit course | `IMPLEMENTED` | browser (renames, reloads, asserts persistence) | No | Yes | Added this pass — the service existed, no UI called it |
| Archive course | `IMPLEMENTED` | `organization.test.ts` (11), browser | No | Yes | Reversible; keeps all lectures and materials |
| Reopen (restore) course | `IMPLEMENTED` | `organization.test.ts` | No | Yes | |
| Delete course | `IMPLEMENTED` | `courses.test.ts` | No | Yes | Soft delete; confirm step in the UI |
| Course isolation | `IMPLEMENTED` | `isolation.test.ts` (21), `verify-isolation` (15 live) | No | Yes | 404 not 403 — existence is not leaked |
| Course-agnostic architecture | `IMPLEMENTED` | `check-course-agnostic.sh` (CI-failing) | No | Yes | Has caught two real leaks, including one of mine this session |
| Folders | `IMPLEMENTED` | `organization.test.ts`, browser | No | Yes | One label on lectures and materials; grouped headings, not a tree |
| Course activity summary | `IMPLEMENTED` | browser | No | Yes | Real data only; says so when there is nothing |
| Exam dates | `IMPLEMENTED` | `profile.test.ts`, browser | No | Yes | Add/remove on web **and mobile** (mobile added this pass) |

## Lectures and recording

| Feature | Status | Tested | Mobile Tested | Demo Ready | Notes |
|---|---|---|---|---|---|
| Create / name lecture | `IMPLEMENTED` | `content.test.ts` (22) | No | Yes | |
| Lecture archive (browse) | `IMPLEMENTED` | `content.test.ts`, browser | No | Yes | Grouped by folder |
| Offline recording (capture) | `PARTIAL` | `offline-queue.test.ts` (29) | **No** | Yes, as tests | Capture needs no network. **Never run on a phone** |
| Local save while offline | `PARTIAL` | `offline-queue.test.ts` | **No** | Yes, as tests | |
| Survive app restart mid-queue | `PARTIAL` | `offline-queue.test.ts` | **No** | Yes, as tests | Fresh queue over persisted storage resumes |
| Resumable upload | `IMPLEMENTED` | `content.test.ts`, `offline-queue.test.ts` | No | Yes | Resumes by byte offset; wrong offset rejected, not merged |
| No duplicate on retry | `IMPLEMENTED` | `content.test.ts`, `offline-queue.test.ts` | No | Yes | `clientRef` generated before recording starts |
| Checksum verification | `IMPLEMENTED` | `content.test.ts`, `offline-queue.test.ts` | No | Yes | Streaming SHA-256 on device, checked against `node:crypto` |
| Upload / processing status | `IMPLEMENTED` | `offline-queue.test.ts`, browser | No | Yes | `queued → uploading → processing → ready`; failures stay visible |
| Transcription | `PARTIAL` | `rag.test.ts` (19) | No | Yes | Pipeline complete. **No ASR engine chosen; no audio benchmarked** |
| Transcript provenance disclosure | `IMPLEMENTED` | `rag.test.ts`, browser | No | Yes | Added this pass. Placeholder transcripts say so on screen |
| Timestamps per segment | `IMPLEMENTED` | `rag.test.ts` | No | Yes | |
| Arabic/English code-switching | `IMPLEMENTED` | `rag.test.ts`, `core.test.ts` | No | Yes | Preserved, not normalised. Dialects unmeasured |
| Confidence bands | `IMPLEMENTED` | `rag.test.ts`, browser | No | Yes | Low-confidence passages visibly marked |
| Instructor-emphasis detection | `IMPLEMENTED` | `rag.test.ts` | No | Yes | Cue phrases are seed data, not code |

## Materials

| Feature | Status | Tested | Mobile Tested | Demo Ready | Notes |
|---|---|---|---|---|---|
| PDF ingestion | `IMPLEMENTED` | `content.test.ts` | No | Yes | Page-anchored |
| DOCX ingestion | `IMPLEMENTED` | `office.test.ts` (15) | No | Yes | Character-anchored; no page numbers claimed, DOCX has none |
| PPTX ingestion | `IMPLEMENTED` | `office.test.ts` | No | Yes | **Slide-anchored** — a citation can say "slide 7" |
| Text ingestion | `IMPLEMENTED` | `content.test.ts` | No | Yes | |
| Audio / video upload | `PARTIAL` | `content.test.ts` | No | Yes | Stored and validated. Transcription depends on an ASR engine |
| Image upload | `PARTIAL` | `content.test.ts` | No | Yes | Stored and listed; no extraction (see Advanced OCR) |
| Scanned PDF handling | `IMPLEMENTED` | `content.test.ts` | No | Yes | Reported with an actionable message, not silently empty |
| Source anchors enforced | `IMPLEMENTED` | `content.test.ts`, DB constraint | No | Yes | `content_chunks_anchor_ck` makes an unanchored chunk unstorable |

## Knowledge

| Feature | Status | Tested | Mobile Tested | Demo Ready | Notes |
|---|---|---|---|---|---|
| Course-scoped search | `IMPLEMENTED` | `rag.test.ts`, browser | No | Yes | Hybrid lexical + dense, RRF-fused |
| Global search (all courses) | `IMPLEMENTED` | HTTP-verified this pass | No | Yes | Added this pass; scoped by the permission filter |
| Deep links to the second / page | `IMPLEMENTED` | `rag.test.ts` | No | Yes | |
| Ask Sanad | `IMPLEMENTED` | `rag.test.ts`, browser | No | Yes | Extractive composition over retrieved chunks |
| Citations | `IMPLEMENTED` | `rag.test.ts`, browser | No | Yes | Validated against the retrieved set before rendering |
| **Refusal below threshold** | `IMPLEMENTED` | `rag.test.ts`, browser | No | Yes | Generator not invoked; API reports `generator: "none"` |
| Answer audit trail | `IMPLEMENTED` | `rag.test.ts` | No | Yes | Retrieved set persisted, refusals included |

## Study

| Feature | Status | Tested | Mobile Tested | Demo Ready | Notes |
|---|---|---|---|---|---|
| Exam Mode | `IMPLEMENTED` | `exam.test.ts` (20), browser | No | Yes | Summary, key terms, emphasis, flashcards, questions |
| Summary | `IMPLEMENTED` | `exam.test.ts` | No | Yes | Extractive — cannot state what the source does not |
| Key terms | `IMPLEMENTED` | `exam.test.ts` | No | Yes | From the course's own vocabulary |
| Flashcards | `IMPLEMENTED` | `exam.test.ts` | No | Yes | `source_chunk_id` is `NOT NULL`; deduplicated |
| Questions with sources | `IMPLEMENTED` | `exam.test.ts` | No | Yes | Every question names a resolvable source |
| Mastery tracking | `IMPLEMENTED` | `exam.test.ts` | No | Yes | Confidence held separately from score |
| Study Coach planning | `IMPLEMENTED` | `coach.test.ts` (20), browser | No | Yes | Deterministic; `EXCLUDE` constraint prevents double-booking |
| Schedule editor | `IMPLEMENTED` | `profile.test.ts`, browser | No | Yes | University, work, gym, sleep, other |
| One-off commitments | `IMPLEMENTED` | `profile.test.ts` | No | Yes | Dated; subtracted before scheduling |
| Rest days respected | `IMPLEMENTED` | seeded demo: Mon/Fri/Sun empty | No | Yes | A day with no free window gets no sessions |
| Offline content access | `PARTIAL` | `offline-queue.test.ts` | **No** | Yes, as tests | Course metadata, transcripts, summary, flashcards. **Not device-verified** |

## Preview surfaces

All eleven are defined in one place (`@sanad/contracts/roadmap`) and rendered identically on web and mobile. None makes a request.

| Feature | Status | Tested | Mobile Tested | Demo Ready | Notes |
|---|---|---|---|---|---|
| AI Voice Tutor | `COMING SOON` | browser | No | Yes | Will route through the same retrieval and refusal |
| YouTube Import | `COMING SOON` | browser | No | Yes | Video *file* upload works; URL import does not |
| Video Understanding | `COMING SOON` | browser | No | Yes | |
| Community Feed | `COMING SOON` | browser | No | Yes | Static preview, labelled, inert |
| Instructor & TA Community | `COMING SOON` | browser | No | Yes | Staff tables exist; no portal, no permission review |
| Live Translation | `COMING SOON` | browser | No | Yes | |
| Smart Translation | `COMING SOON` | browser | No | Yes | Language *selection* works and is honest about its limits |
| Collaborative Study | `COMING SOON` | browser | No | Yes | |
| AI Study Groups | `COMING SOON` | browser | No | Yes | |
| Advanced OCR | `COMING SOON` | browser | No | Yes | |
| Live Transcription | `COMING SOON` | browser | No | Yes | Decided against for now — [LIVE_TRANSCRIPTION_DECISION.md](LIVE_TRANSCRIPTION_DECISION.md) |

## Future — not exposed in the app

| Feature | Status | Notes |
|---|---|---|
| Professor / TA portals | `FUTURE` | `course_staff`, `instructor_profiles`, `teaching_assistant_profiles` exist; no UI |
| Google / Apple sign-in | `FUTURE` | `auth_identities` is built for it; adds a dependency for no competition value |
| S3-compatible storage | `FUTURE` | `StorageProvider` exists; only `LocalDiskStorage` is implemented |
| Mail delivery | `FUTURE` | Blocks public deployment, not the demo |
| Gamification | `FUTURE` | Out of scope |
| AI whiteboard | `FUTURE` | Out of scope |

---

### Added in the finalization pass

| Feature | Status | Tested | Mobile Tested | Demo Ready | Notes |
|---|---|---|---|---|---|
| Citation opens the source | `IMPLEMENTED` | Yes | NOT TESTED | Yes | `?t=` and `?page=`/`?slide=` now scroll to and highlight the cited passage. **This was broken** — every document citation was a 404 and every timestamp landed at the top |
| Document viewer | `IMPLEMENTED` | Yes | NOT TESTED | Yes | `/materials/{id}` shows the extracted text with its page/slide anchors — the text Sanad actually quotes, so an extraction error is visible rather than hidden |
| Evidence strength | `IMPLEMENTED` | `saved-answers.test.ts` | NOT TESTED | Yes | A word, never a percentage. Derived from the fused retrieval score and the count of distinct validated sources |
| Saved answers | `IMPLEMENTED` | `saved-answers.test.ts`, `isolation.test.ts` | NOT TESTED | Yes | One column on `qa_messages`, so citations come along unchanged. Refusals cannot be saved |
| Progress overview | `IMPLEMENTED` | `saved-answers.test.ts` | NOT TESTED | Yes | Counts and rows only. Nothing estimated, nothing scored by a model |

## Counts

| Status | Count |
|---|---|
| `IMPLEMENTED` | **57** |
| `PARTIAL` | **8** |
| `COMING SOON` | **11** |
| `FUTURE` | **6** |

Counted from the rows above (77 in total), not estimated.

The eight `PARTIAL` rows, named: offline recording capture, local save while offline, app-restart recovery, offline content access (all four software-tested but never on a phone), transcription (no engine chosen), email verification (no delivery), audio/video upload (stored, transcription pending an engine), image upload (stored, no extraction).

## What was actually executed to produce this table

```
pnpm test                 303 passed, 17 files
pnpm test:asr              55 passed
pnpm typecheck              0 errors
mobile tsc --noEmit         0 errors
pnpm build                  clean
expo export (android)       955 modules → 2.66 MB Hermes bundle
check-course-agnostic       OK, 25 seeded terms, none in code
verify-isolation            17/17 over HTTP
verify-demo                 30/30 — every beat in DEMO.md
verify-ui                   43/43 in Chromium, no console errors
pnpm bootstrap (fresh clone)    clean checkout → seeded demo
pnpm demo:reset             database rebuilt and reseeded
```

No physical Android device was available. Nothing in the "Mobile Tested" column says yes.
