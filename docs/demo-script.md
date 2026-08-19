# Demo script — 5 minutes

The demo *is* the product for competition purposes. Everything in [`product-scope.md`](product-scope.md) exists to serve these beats. If a feature has no beat here, it isn't in scope.

The narrative arc is the pitch: **one lecture becomes an archive, becomes an answer, becomes an exam.**

---

## Opening line (say it before touching anything)

> "Sanad is not just an AI note-taking app. It is a complete AI academic companion that supports students from the moment a lecture starts until they finish their exams."

Then, in one breath, the frame:

> "Everything you're about to see comes from one real Digital Logic lecture. Sanad doesn't know anything except what this student's professor actually said."

That second sentence sets up every beat that follows, and it's what makes the citation moments land.

---

## The beats

### 1 · Live transcription (0:00 – 1:00)

Play real lecture audio. Mixed Arabic/English on screen within ~2 seconds.

**Point at the screen when the professor says «الـ flip-flop بيخزن bit واحد».** Let the judges watch grey draft text resolve into corrected black text, and "فليب فلوب" turn into **flip-flop**.

> "Notice it didn't force this into one language. That's how engineering is actually taught here — and Sanad keeps the technical terms in English where they belong."

Show one dotted-underlined uncertain span.

> "And where it wasn't sure it heard correctly, it says so instead of pretending."

**Why this beat is first:** it's the hardest thing to fake, so it buys credibility for everything after it.

### 2 · The archive builds itself (1:00 – 1:30)

Stop the recording. Without a single click: `Digital Logic → Lecture 04 → 19 August` — transcript, recording, summary, key concepts, flashcards.

> "The student didn't do anything. By the end of the semester this archive exists for every lecture."

### 3 · Search (1:30 – 2:15)

Type **`K-map`**.

Results: the lecture moment, the slide, the PDF page, related questions — all in one list.

Now the moment that proves the retrieval is real: search **`خريطة كارنوف`** and land on the same English content.

> "The professor said it in English. The student thought about it in Arabic. Sanad connects them."

Click a result → the player jumps to that exact second.

### 4 · Ask Sanad (2:15 – 3:15)

> "What did the professor say about K-maps?"

Answer appears with citations. Click one → jumps to lecture 4, 23:14, and the audio plays the professor saying it.

> "Every sentence traces back. Not the internet — this student's lecture."

**Then the trust beat.** Ask something the course never covered:

> "What did he say about neural networks?"

Sanad declines: *not in your materials.*

> "This matters more than any feature on the list. A study tool that invents an answer during exam week is worse than useless."

**Do not skip this beat under time pressure.** It's fifteen seconds and it's the most persuasive thing in the demo.

### 5 · Exam Mode (3:15 – 4:15)

One button. The pack appears: summary, key concepts, flashcards, MCQs, a practice exam with model answers.

Then open a flagged item:

> "⚑ Lecture 6, 34:12 — the professor said this would be on the exam."

Play those four seconds of audio. Let the room hear the professor say it.

> "Sanad was in the lecture. It heard him say this was important, and it built the practice exam around it. No general-purpose study app can do that, because it wasn't in the room."

**This is the moment the demo wins or doesn't.** Rehearse it until the audio playback is instant.

### 6 · The coach (4:15 – 4:45)

Show the study plan: exam Thursday, work Tuesday, gym Monday and Wednesday.

> "You're strong on Boolean algebra. K-maps are weak. 25 minutes on K-maps tonight."

> "Sanad knows the weak topics because it graded the quizzes it generated from the lectures it recorded. That loop is the product."

### 7 · Close (4:45 – 5:00)

> "Before the lecture, during it, after it, every day of studying, and into the exam. That's Sanad today — for one course, working end to end. Next: the whole faculty. Instructors see which topics their students are struggling with. Students help each other inside the course. Professors upload directly."

One slide with the blue future-vision list. Stop talking.

---

## Rules for demo day

**Rehearse on recorded audio.** Live microphones fail in loud rooms — this is the single most common way a good demo dies. Run beat 1 from a file, then optionally do one short genuinely-live segment as a flourish once the recorded version has already proven the point.

**Seed everything in advance.** All twelve lectures ingested, indexed, and verified the night before. Nothing generates for the first time on stage.

**Have a fallback path.** Screen recording of the full flow, ready to play. If the network dies you keep talking over video instead of watching a spinner.

**Every query is pre-tested.** Every search term, every question, every citation click — verified working that morning. No improvising new queries in front of judges.

**One presenter drives, one talks.** Splitting attention between narration and clicking is how beats get rushed.

---

## Q&A the judges will ask

**"How is this different from ChatGPT / Otter / Notion AI?"**
Three things: it handles Arabic/English code-switching with a technical glossary, it refuses to answer outside the student's own materials, and it heard the professor say what would be on the exam. The first is a language problem general tools don't solve; the second is a trust property they deliberately don't have; the third requires being in the room.

**"What about hallucination?"**
Retrieval gates the model — below a confidence threshold we don't call it at all. Citations are validated against the retrieved set before rendering. And you just watched it decline a question.

**"Does this scale beyond Digital Logic?"**
Nothing is subject-specific except one glossary table. A new course is a new glossary, seeded in an afternoon — and it can be bootstrapped from the course's own materials.

**"What about privacy / recording consent?"**
Real question, answer it straight: recordings belong to the student, stored per-account, and institutional deployment goes through the professor-upload path on the roadmap rather than around it.

**"Why didn't you build the community / TA dashboard?"**
Because they need hundreds of real students to be anything but a mockup, and we'd rather show you eight things that work than fifteen that don't. The TA dashboard is the business model — it runs on data the student side is already generating.
