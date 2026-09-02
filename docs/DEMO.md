# Competition demo — exact steps

A demo that depends on something generating correctly for the first time on stage is a demo that fails on stage. Everything below runs from **seeded, deterministic data**: the same transcripts, the same PDFs, the same exam date, the same study plan, every time. Nothing in the script asks the product to produce something it has not already produced.

Every step here has been run end to end against a freshly created database.

---

## 0. Before the room

```bash
pnpm install
pnpm build                              # ~10 s

createdb sanad_demo                     # or: psql -c 'CREATE DATABASE sanad_demo;'
export DATABASE_URL=postgres://<user>@localhost:5432/sanad_demo

pnpm db:migrate                         # applies all migrations
pnpm db:seed:demo                       # seeds the whole account

pnpm --filter @sanad/web start          # http://localhost:3000
```

`pnpm db:seed:demo` prints the account it created:

```
Account: demo@university.edu / demo-password-1234

Computer Science — Data Structures
  · Lecture 03 — Sorting and complexity (9 segments)
  · Lecture 04 — Hash tables (7 segments)
  · week-4-slides.pdf
  · week-4-lecture-deck.pptx (slide-anchored)
  · tutorial-notes.docx

Biology — Cell Structure
  · Lecture 02 — Membrane transport (7 segments)
  · membrane-handout.pdf

Exam in 4 days · 16 study sessions planned
```

The session count varies a little with the day you seed on — the plan runs from today to the exam — but it is always well short of a free-evenings-every-night number, because the seeded week has university, work and a gym in it. That is Beat 7.

**To reset between run-throughs** (about 30 seconds):

```bash
dropdb sanad_demo && createdb sanad_demo && pnpm db:migrate && pnpm db:seed:demo
```

Reset before the real run. A demo account that has been clicked through already has answered questions and completed study sessions, which changes what the coach says.

### Checks worth running once, in the room, before anyone is watching

```bash
pnpm test                    # 286 tests
pnpm typecheck               # clean
pnpm check:course-agnostic   # no subject term leaked into code
pnpm verify:isolation http://localhost:3000
pnpm verify:ui http://localhost:3000    # drives the real UI in a browser
```

The last one registers a throwaway second student and confirms they cannot reach the demo account's data. It is also worth having on screen if a judge asks about privacy.

---

## 1. The opening line

> **"Every student records lectures. Almost nobody ever listens to them again."**

Then: Sanad turns a recording into something you can search, question and revise from — and it answers only from *your* course, or it tells you it doesn't know.

---

## 2. The script

Sign in at `http://localhost:3000/sign-in` as `demo@university.edu` / `demo-password-1234`.

### Beat 1 — Two unrelated courses (20 seconds)

The dashboard shows **Computer Science — Data Structures** and **Biology — Cell Structure**.

> "Sanad has no idea what these subjects are. Neither course is in the code — a student typed both in. That is why it works for any faculty."

If asked to prove it: `pnpm check:course-agnostic` fails CI if any seeded subject term appears in application code.

### Beat 2 — The lecture archive and the transcript (40 seconds)

Open **Data Structures → Lecture 04 — Hash tables**.

Point at:
- **Timestamps on every line.** `0:00`, `0:12`, `0:24` — every sentence is anchored to a moment in the audio.
- **Arabic and English in the same lecture**, kept as the professor said them. `الـ collision بيحصل لما مفتاحين يروحوا لنفس الـ bucket` is not translated, not transliterated, not "cleaned up".
- **A flagged moment**, at `1:12`: *"This is important for the exam: know when to resize the table."* Sanad detected the professor's own emphasis phrasing and marked it.
- **An uncertain passage at `1:00`**, underlined and greyed: `الـ rehashing بيحصل لما الـ load factor يعدي الحد`. The recognizer was not confident there, and the transcript says so rather than presenting every line as equally reliable.

- **A note at the top saying this is a demo transcript**, not speech recognition. No engine is installed, so Sanad generated placeholder sentences rather than transcribing.

> "This is the sentence, at the second it was said — and where Sanad hasn't actually recognised the speech, it tells you instead of letting placeholder text look like a real transcript. That is the same instinct as the refusal you'll see in a moment."

### Beat 3 — Search (20 seconds)

In the course page, search **`open addressing`**.

Three results: `week-4-lecture-deck.pptx — slide 3`, then two lecture moments at `0:48` and `0:24`, each a link that opens the transcript **at that second**.

> "Not a keyword match on a filename. The exact slide, and the exact moment in the lecture."

### Beat 4 — Ask Sanad, grounded (45 seconds)

Ask: **"What is chaining in a hash table?"**

The answer quotes the material and lists its sources — every anchor kind Sanad supports, in one answer:

```
tutorial-notes.docx
Lecture 04 — Hash tables — 0:00
week-4-slides.pdf — page 1
week-4-lecture-deck.pptx — slide 1
```

> "A Word document, the lecture at zero seconds, page one of the PDF, and slide one of the deck. All four are links. Nothing here is generated prose — every sentence is quoted from the student's own material, so it cannot say something the course does not."

**Say this too, and point at the note above the box:** some of these lectures have demo transcripts rather than real speech recognition, and Sanad says so rather than letting a timestamp inside placeholder text look like evidence. The documents are read for real.

### Beat 5 — The refusal (30 seconds) — **the most important beat**

Ask: **"What is the boiling point of liquid nitrogen at high altitude?"**

```
I couldn't find enough evidence for this in your course materials.
No answer was generated — retrieval found insufficient evidence.
```

> "That is the whole product. A tool that confidently invents an answer during revision week is worse than no tool. Sanad did not generate a wrong answer and then hedge — it never ran the generator at all, because retrieval did not clear the confidence threshold."

If a judge pushes: the same question against the Biology course also refuses, and the confidence gate is a fixed threshold on a normalized retrieval score, not a phrase filter.

### Beat 6 — Exam Mode (40 seconds)

Course page → **Prepare me for the exam**.

- **What the instructor flagged**, with timestamps and links.
- **Course summary** — extracted sentences, one per line, each one a sentence the professor actually said.
- **Key terms** — pulled from the course's own vocabulary.
- **Flashcards**, e.g. `الـ time _____ بتاعت merge sort هي n log n في كل الحالات` → `complexity`.
- **Practice questions**, each labelled with its source, e.g. `Source: Lecture 03 — Sorting and complexity — 0:24`.

> "Every card and every question names where it came from. If a question looks wrong, you can go and check — that link is the answer."

### Beat 7 — The study coach (45 seconds) — **the second-best beat**

**Study plan** in the nav.

The seeded week is a real one, and that is the point:

| | |
|---|---|
| Monday | University 09:00–15:00, then work 16:00–21:00 |
| Tuesday | Free |
| Wednesday | Gym 18:00–20:00 |
| Thursday | University 09:00–15:00 |
| Friday | Gym |
| Saturday | Free |
| Sunday | Rest — nothing declared |

Press **Plan my week around this**. Then point at the result — read the count off the screen rather than quoting one, since the plan runs from today to the exam:

- **Monday has zero sessions.** University and work take the whole day.
- **Wednesday starts at 20:00**, after the gym — not during it.
- **Friday and Sunday are empty.**
- **Tuesday starts at 14:00 and Saturday at 10:00** — exactly the windows declared as free.

> "Most study planners ask what you want to study. Sanad asks what your week actually looks like — and then it doesn't schedule over your shift. This is arithmetic, not a language model guessing: same inputs, same plan, every time, and the database itself refuses to double-book a slot."

Add a window live if you want — pick a day, pick *Work*, set the hours, press Add, then re-plan and watch the sessions move.

### Beat 7b — Folders and archiving (15 seconds, optional)

On the course page, lectures group under folder headings ("Week 3", "Revision"). On the dashboard, **Archive** files a finished course away — reversibly, keeping every lecture and transcript inside it.

> "Filing, not deleting. A student tidying up should never lose a semester."

### Beat 8 — Offline recording (40 seconds)

This is the mobile app (`apps/mobile`), and it is the part students actually asked for.

> "A lecture hall basement has no signal. Sanad records anyway — recording never touches the network. The file is written to the phone, queued, and uploaded when you're back online. If the app is killed mid-upload it resumes from the byte it reached, and if the network drops at exactly the wrong moment it never creates a second copy of the lecture, because the idempotency key is generated before recording starts."

Show the **Queue** tab: each recording with its state — `queued`, `uploading`, `processing`, `ready` — and a failed one stays visible with a retry, never silently dropped.

**Say what is true about its status:** the queue's logic is covered by 29 tests including app-restart and mid-upload-drop recovery, and the app compiles and bundles — but it has not been run on a physical device. If the mobile app is not on a phone in the room, demo this beat from the queue tests instead of from a simulator:

```bash
pnpm exec vitest run tests/integration/offline-queue.test.ts
```

### Beat 8b — The roadmap (40 seconds)

Bottom of **Study plan**, bottom of any **course**, and the **Community** tab. Eleven cards, each saying what it will do and that it is not available:

**AI Voice Tutor** · **YouTube Import** · **Video Understanding** · **Community Feed** · **Instructor & TA Community** · **Live Translation** · **Smart Translation** · **Collaborative Study** · **AI Study Groups** · **Advanced OCR** · **Live Transcription**

Open the Community preview — posts, a TA answer, an AI reply badged as AI.

> "That is the roadmap, and none of it is pretending. Nothing on these screens makes a request, because a preview that behaves like a broken feature is worse than no preview. They're defined in one file that both the web app and the phone read, so a feature can't be 'coming soon' here and quietly implied to work there."

One more, on the course page: pick **中文** in Exam Mode.

> "It tells you it can't translate yet instead of quietly showing you the English. Everything in Exam Mode is quoted from the lecture — translating a quotation would break the link between a sentence and the moment it came from."

### Beat 9 — Privacy (20 seconds)

```bash
pnpm verify:isolation http://localhost:3000
```

Fifteen checks, live, against the running server: a second student holding the demo account's course, lecture and material ids cannot open any of them, cannot search them, and cannot get Sanad to answer from them — while the owner still can.

> "A student's recordings are their own. That is not a policy in a document, it's a check that runs."

---

## 3. Questions you should expect

**"What does it cost to run?"**
Zero recurring. Summaries, flashcards, questions and answers are extractive and deterministic — no LLM API, no per-token cost. Embeddings are a 384-dimension ONNX model on CPU, in process. Every AI feature sits behind a provider interface, so a better model is a configuration change.

**"Which speech recognizer?"**
Undecided, honestly. The benchmark harness is built and self-tested, the thresholds were fixed in advance, and **no real lecture audio has been supplied yet** — so no engine has been measured and no winner has been chosen. See [ASR_BENCHMARK.md](../ASR_BENCHMARK.md) §10. Transcription sits behind `AsrProvider`, so choosing later does not mean rewriting.

**"Is it live transcription?"**
No, and deliberately. See [LIVE_TRANSCRIPTION_DECISION.md](LIVE_TRANSCRIPTION_DECISION.md). Recording-first works with no signal, survives the app being killed, and lets a slower and more accurate model run — which matters more for code-switched technical speech than immediacy does.

**"How do you know it doesn't hallucinate?"**
It cannot compose a sentence the material does not contain: the composer quotes retrieved chunks. Citations are validated against the retrieved set before rendering, every chunk is required by a database constraint to carry an anchor, and every stored question and flashcard has a non-null source chunk. Below the confidence threshold the generator is never invoked.

**"Can a professor upload the official slides?"**
A professor portal is not in this build. A *student* can upload a `.pptx` and get slide-numbered citations out of it — worth trying during Beat 6.

**"What file types can it read?"**
PDF, plain text, DOCX and PPTX, plus audio, video and images stored as-is. PPTX is the interesting one: each slide is its own citation anchor, so an answer can say "slide 7".

**"Does it have a community feed, or a voice assistant?"**
Not yet — and the app says so on the screen rather than only in the pitch. See Beat 8b.

---

## 4. If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Sign-in returns 429 | Rate limiting, from repeated run-throughs | `psql sanad_demo -c 'TRUNCATE rate_limit_buckets;'` |
| A material sits on `processing` | A job did not drain | The course page polls and updates itself; if it stalls, re-run `pnpm db:seed:demo` on a fresh database |
| Ask refuses a question it should answer | The wrong course is selected | Ask from inside the course page, not the dashboard |
| The page shows an empty course list | Wrong `DATABASE_URL` | Confirm the server was started with `DATABASE_URL` pointing at `sanad_demo` |

**Do not improvise new content on stage.** Every beat above uses data that is already in the database. Typing a fresh question is fine — Beat 5 depends on it — but uploading a new file or recording a new lecture in front of judges puts a first-time code path on the projector.
