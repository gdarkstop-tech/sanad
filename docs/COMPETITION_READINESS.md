# Competition readiness

Written to be checked, not believed. Every claim below names the command that produces it.

**The one thing to read first:**

> **Mobile runtime and microphone capture have not been physically verified.**

No Android device was available — `adb` is not installed and there is no USB bus. The app typechecks against real Expo types and bundles to Hermes bytecode, and the queue underneath it has 29 Node tests — but not one of them involves a microphone, and nothing has rendered on a device. §4 says exactly what that means for the demo.

---

## 1. What works

Verified by tests, by HTTP against a running server, and by driving a real browser.

**Accounts.** Registration, login, logout, session persistence, Argon2id passwords, CSRF double-submit, Postgres rate limiting (no Redis), and a profile holding university, faculty, department, academic year, major and student number.

**Courses.** Student-created and student-owned, in any discipline. Create, rename, re-code, change language, archive, restore, delete. Archived courses leave the list and keep everything inside them. No subject exists in application code — CI fails the build if one appears.

**Lectures.** Create, name, upload or record, organise into folders, browse the archive. Transcripts carry per-segment timestamps, language and code-switch detection, and confidence bands, with low-confidence passages visibly marked.

**Recording, offline.** Capture needs no network. A `clientRef` is generated *before* the first byte, so a replayed upload resumes rather than creating a second lecture. Uploads resume by byte offset; a wrong offset is rejected rather than merged; the device computes a streaming SHA-256 the server verifies. A failed upload stays visible with a retry instead of disappearing.

**Materials.** PDF (page-anchored), PPTX (**slide-anchored**), DOCX (character-anchored), plain text. Audio, video and images are stored and validated. A scanned PDF is reported as one, with a message you can act on.

**Knowledge.** Hybrid search — Postgres full-text OR'd with pgvector cosine, fused by reciprocal rank — scoped to one course or across all of them. Every result deep-links to the second of the lecture or the page of the document. Ask Sanad answers by quoting retrieved chunks and citing each one.

**Refusal.** Below the retrieval threshold the generator is never invoked. The API reports `generator: "none"`, and the UI says "No answer was generated — retrieval found insufficient evidence." This is checked in a browser, not just in a test.

**Exam Mode.** Summary, key terms, instructor-flagged moments, flashcards and questions — all extracted from the course's own content, each carrying a non-null source chunk.

**Study Coach.** Deterministic scheduling around a real week: university, work, gym, sleep, one-off commitments and exam dates. It does not schedule over a commitment, and the database refuses to double-book a slot independently of the scheduler.

**Isolation.** One student cannot reach another's courses, lectures, recordings, transcripts, materials, upload sessions, search results, Ask context, Exam Mode or quiz attempts. Refusals return 404, not 403, so existence is not leaked.

**Honesty about transcripts.** Without whisper.cpp installed, the pipeline generates placeholder sentences instead of transcribing. That is now disclosed on the lecture page and badged in the archive, because on screen it is otherwise indistinguishable from a real transcript.

## 2. What was physically tested

Executed in this environment, with output read:

| Check | Command | Result |
|---|---|---|
| TypeScript tests | `pnpm test` | **286 passed**, 15 files |
| Python tests | `pnpm test:asr` | **55 passed** |
| Typecheck | `pnpm typecheck` | 0 errors |
| Mobile typecheck | `pnpm --filter @sanad/mobile exec tsc --noEmit` | 0 errors |
| Production build | `pnpm build` | clean |
| Mobile bundle | `expo export --platform android` | 955 modules → 2.66 MB Hermes |
| Course-agnostic | `pnpm check:course-agnostic` | OK, 25 terms, none in code |
| Isolation over HTTP | `pnpm verify:isolation <url>` | **17/17** |
| Demo beats | `pnpm verify:demo <url>` | **30/30** — every claim in DEMO.md |
| Browser UI | `pnpm verify:ui <url>` | **43/43**, no console errors |
| Clean install | `pnpm bootstrap` on a fresh `git clone` | clean checkout → seeded demo |
| Demo reset | `pnpm demo:reset` | database rebuilt and reseeded |
| Clean migration | `pnpm db:migrate` from an empty database | all 6 migrations applied |

The browser run drives the product the way a person does: signs in through the form, renames a course and reloads to prove it persisted, asks a grounded question and reads the citations, asks an unrelated one and confirms the refusal says no generator ran, opens Exam Mode, switches the study language and reads the notice, and checks the placeholder-transcript disclosure.

## 3. What was only software-tested

These have thorough automated coverage and have **not** been exercised on the hardware they are for:

- **Offline recording capture** — 29 tests cover no-network capture, mid-upload drops, offset resynchronisation, capped backoff, app-restart recovery and duplicate prevention, all against an in-memory server that models the real upload contract. Not one of them involves a microphone.
- **Offline content access** — reading cached courses with networking disabled is tested in Node, not on a phone.
- **The 16 mobile screens** — they compile and bundle. Nothing has rendered on a device.

## 4. What remains unverified

1. **The mobile app on a real device.** **Mobile runtime and microphone capture have not been physically verified.** Permissions, audio capture, background behaviour, and the Expo Go pairing itself are all unknown in practice. This is the single biggest gap. See §6 for how the demo handles it.
2. **Real speech recognition.** No ASR engine has been chosen, because **no lecture audio has been supplied to benchmark one** — [ASR_BENCHMARK.md](../ASR_BENCHMARK.md) §10. `whisper-cli` is not installed here, so every transcript in this build is placeholder text, and the app now says so.
3. **Arabic RTL rendering by eye.** Mixed-script segments store, serve and test correctly; the visual result has not been reviewed on a device.
4. **Arabic dialect coverage.** Unmeasurable until real audio exists.
5. **Concurrent load.** Single-user local use is all that has been exercised.

## 5. Known limitations

1. **Answers read as quotations, not prose.** That is what makes them incapable of stating something the source does not say. Worth setting as an expectation in the opening rather than letting a judge discover it at the citation panel.
2. **No mail delivery.** Verification tokens are generated and stored hashed; no SMTP transport is wired. Blocks public deployment, not the demo.
3. **No translation.** Language selection works and says plainly that content stays in the language of the lecture. Nothing is translated.
4. **Local disk storage only.** `StorageProvider` exists so S3 is a provider swap, but only `LocalDiskStorage` is implemented.
5. **Not deployed.** Runs on a laptop against local PostgreSQL. HTTPS, secret management, backups and retention enforcement all remain.
6. **Legacy `.doc` / `.ppt` are refused**, not converted — with a message saying what to do instead.
7. **The plan's session count varies by weekday**, because it runs from today to the exam. The structure (which days are empty, when sessions start) is stable; the total is not. Read it off the screen.

## 6. Exact demo sequence

Full script with what to say: [DEMO.md](DEMO.md). The short form:

| # | Beat | Show | Say |
|---|---|---|---|
| 1 | Sign in | `demo@university.edu` / `demo-password-1234` | "Every student records lectures. Almost nobody listens to them again." |
| 2 | Two courses | Data Structures, Cell Structure | "Sanad has no idea what these subjects are — a student typed both." |
| 3 | Lecture + transcript | Timestamps, Arabic/English in one line, a flagged moment at 1:12, an uncertain passage at 1:00 | "The professor's actual sentence, at the actual second." |
| 4 | Search | `collision` → two results at 0:24 and 0:00 | "Not a filename match. The exact moment." |
| 5 | Ask Sanad | Three citations: lecture 0:00, slides page 1, lecture 0:48 | "Every sentence is quoted from the student's own material." |
| 6 | **The refusal** | Ask about liquid nitrogen → `generator: none` | "It didn't generate a wrong answer and hedge. It never ran the generator." |
| 7 | Exam Mode | Summary, key terms, flashcards, sourced questions | "Every card names where it came from." |
| 8 | Study Coach | Monday empty against university + work; Wednesday starts 20:00 after the gym | "It asks what your week looks like, then doesn't schedule over your shift." |
| 9 | Offline recording | The queue tests, or a phone if one is paired | See §4 — **say it has not been device-tested** |
| 10 | Roadmap | Eleven Coming Soon cards; the Community preview | "None of it is pretending. Nothing on these screens makes a request." |
| 11 | Privacy | `pnpm verify:isolation` live | "Not a policy in a document. A check that runs." |

**Beat 9, if no phone is paired.** Run the queue tests on screen instead and say plainly that the app has not been on a device:

```bash
pnpm exec vitest run tests/integration/offline-queue.test.ts
```

Do not claim device verification that did not happen. A judge who asks "have you run this on a phone?" and gets a straight "not yet — here is what we did verify" is a better outcome than one who catches an overstatement.

## 7. Setup instructions

From a clean machine. Needs Node 22+, pnpm 10+, and PostgreSQL 16 with pgvector.

```bash
git clone <repo> && cd sanad
pnpm bootstrap                 # installs, writes .env, checks the DB, migrates, seeds
pnpm dev                   # → http://localhost:3000
```

No PostgreSQL installed? One optional container, nothing else:

```bash
pnpm bootstrap:docker          # starts pgvector/pgvector:pg16, then does the above
```

Mobile, on the same Wi-Fi as the laptop:

```bash
# apps/mobile/.env → EXPO_PUBLIC_SANAD_API_URL=http://<your-laptop-ip>:3000
pnpm mobile                # scan the QR code with Expo Go
```

`localhost` on a phone means the phone. Use the laptop's LAN address, or `10.0.2.2` on an Android emulator.

**Nothing here needs an account, an API key, or a paid service.**

## 8. Reset instructions

```bash
pnpm demo:reset            # ~30 seconds: drop, recreate, migrate, seed
```

Run it before the real demo. An account that has been clicked through already has answered questions and completed study sessions, which changes what the coach says.

Verify everything at once:

```bash
pnpm verify:all http://localhost:3000
```

It continues past failures so one problem does not hide the state of the rest, and skips the server-dependent checks rather than failing them when nothing is running.

`pnpm verify:demo` deserves a special mention: it walks every beat [DEMO.md](DEMO.md) promises and checks the product actually does it. A demo script is a set of promises made to a room, and a seed change or a renamed roadmap entry should break there rather than on stage.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `pnpm bootstrap` stops at the database step | PostgreSQL not running, or no pgvector | `pnpm check:db` names which. Or `pnpm bootstrap:docker` |
| Sign-in returns 429 | Rate limiting, from repeated run-throughs | `psql "$DATABASE_URL" -c 'TRUNCATE rate_limit_buckets;'` |
| A material sits on `processing` | A job did not drain | The course page polls itself; if it stalls, `pnpm demo:reset` |
| Ask refuses something it should answer | Wrong course selected | Ask from inside the course page, not the dashboard |
| Empty course list | Wrong `DATABASE_URL` | Confirm the server started with it pointing at the demo database |
| Phone cannot reach the server | `localhost` in the mobile env | Use the laptop's LAN IP; check both are on the same network |
| `pnpm verify:ui` exits 2 | No Chromium found | `npx playwright install chromium`, or set `CHROME_PATH`. This check is optional |
| Transcript looks generic | No ASR engine installed — expected | The app says so on the lecture page. Install whisper.cpp for real recognition |

## 10. Future roadmap

Three categories, kept separate on purpose. The full table is in [FINAL_FEATURE_MATRIX.md](FINAL_FEATURE_MATRIX.md).

**Available now** — everything in §1, all of it tested.

**Coming Soon** — eleven features with a labelled preview surface and no backend: AI Voice Tutor, YouTube Import, Video Understanding, Community Feed, Instructor & TA Community, Live Translation, Smart Translation, Collaborative Study, AI Study Groups, Advanced OCR, Live Transcription. Defined once in `@sanad/contracts/roadmap` and rendered identically on web and mobile, so a feature cannot read as planned in one place and be implied to work in another. None makes a request.

**Future** — not exposed in the app at all: professor and TA portals, federated sign-in, S3 storage, mail delivery, gamification, an AI whiteboard.

The first three things worth doing after the competition, in order:

1. **Run the mobile app on one Android device.** It is the largest gap between "tested" and "works".
2. **Supply 30 minutes of consented lecture audio and run the benchmark.** Everything downstream reads the transcript, and right now every transcript is a placeholder.
3. **Review Arabic RTL on a device**, then wire mail delivery before anything is deployed publicly.
