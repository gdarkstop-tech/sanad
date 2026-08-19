# Product Scope — what we build, what we don't

This document takes every feature from the Sanad vision and gives each one a verdict. The verdicts are the point. A feature list without verdicts is a wish list, and a wish list is how competition projects end up with fifteen half-features and no working demo.

**Three verdicts:**

| Verdict | Meaning |
|---|---|
| 🟢 **Competition scope** | We build it, end to end, and it works in the live demo |
| 🟡 **Stretch** | We build it only if the green list is genuinely finished |
| 🔵 **Future vision** | It goes on a slide. We do not write code for it. |

---

## The reasoning behind the cut

Three filters decide where each feature lands.

**1. Does it demo with one user and one course?**
A feature that needs 500 students to look alive will look dead on stage. The community feed, the FAQ aggregator, and the TA analytics dashboard are all excellent ideas that are structurally impossible to demo convincingly with a single account and one seeded course. Showing a judge an empty feed or a chart built from three data points actively *costs* credibility — it reads as a mockup, and it makes them wonder what else is a mockup.

**2. Is it on the spine, or hanging off it?**
The spine is: **audio → transcript → indexed knowledge → grounded answers → study signal → exam prep.** Each link makes the next one possible. Cut any link and everything downstream dies. Features on the spine are non-negotiable. Features hanging off the spine (gamification, voice chat, avatars) can be removed without breaking anything — which is exactly why they're the ones to remove.

**3. Would a judge believe it's a real product or a demo trick?**
Grounded citations are the answer to this. Anyone can wire an LLM to a chat box in a weekend, and every judge at the competition will have seen ten of those. The thing that separates Sanad is that it will refuse to answer from general knowledge and will point at minute 23:14 of lecture 4 instead. Build the feature that proves the system is real, not the feature that's flashiest.

---

## Competition scope

Eight features. All eight are on the spine. All eight appear in the demo.

### 1. 🟢 Live transcription with Arabic/English code-switching

The professor speaks; text appears within ~2 seconds. Mixed-language sentences stay mixed — we do **not** normalize «الـ flip-flop بيخزن bit واحد» into pure Arabic or pure English, because that sentence *is* how engineering is taught in Egyptian and Gulf universities, and preserving it is the entire point.

Text arrives in two tiers: a fast grey draft, replaced a few seconds later by a corrected black final. This is what a real-time system honestly looks like, and it reads as more trustworthy than fake-instant perfect text.

**Done means:** a 10-minute real Digital Logic recording transcribes with correct segmentation and mixed-script output, live, on stage.

### 2. 🟢 Technical-term correction + confidence indicator

A course glossary biases the recognizer and drives a correction pass. "كي ماب" becomes **K-map**, "فليب فلوب" becomes **flip-flop**, "مالتيبلكسر" becomes **multiplexer**.

Low-confidence spans are visually marked rather than presented as fact. This was one of the strongest instincts in the original vision and it should be visible in the demo — a system that admits "I'm not sure I heard this correctly" is more convincing than one that never hesitates.

**Done means:** a side-by-side of raw ASR output vs. Sanad's corrected output on the same audio, with at least five real term fixes visible and uncertain spans flagged.

### 3. 🟢 Automatic lecture archive

Every session produces `Digital Logic → Lecture 04 → 19 August` containing: full transcript with timestamps, the recording, a summary, key concepts, flashcards, questions, and professor-emphasized points.

**Done means:** it happens with zero clicks after the recording stops.

### 4. 🟢 Upload any study material

PDF, PPTX, DOCX, images, audio, video. Everything lands in the same index as the transcripts, so a search hit can be a slide, a lecture minute, or a scanned note without the student caring which.

*Scope note:* handwritten Arabic OCR is genuinely hard. Printed material and typed slides work; handwritten notes are best-effort and we won't build the demo around them.

**Done means:** the course PDF and slide deck are searchable in the same result list as the lecture audio.

### 5. 🟢 Unified search

One box. Type `K-map`, get every lecture moment, slide page, note, and generated question that touches it — ranked, each result clickable straight to the source position.

Arabic search must find English content and vice versa: searching `خريطة كارنوف` has to return the K-map lecture segment. This is a retrieval design problem, not a nice-to-have — see [architecture](architecture.md#cross-lingual-retrieval).

**Done means:** searching one term surfaces at least three different *kinds* of source, cross-lingually.

### 6. 🟢 Ask Sanad — grounded Q&A with citations

The centerpiece. The student asks a question; Sanad answers using only their course materials and cites the timestamp or page for every claim. Clicking a citation jumps the player to that second.

**And it refuses.** Ask about something the professor never covered and Sanad says so plainly rather than filling the silence with plausible-sounding general knowledge. Put this refusal in the demo *on purpose* — it's a fifteen-second beat that will do more for the team's credibility than any feature on the list.

**Done means:** every answer carries at least one clickable citation, and out-of-scope questions get a clean "not in your materials."

### 7. 🟢 Exam Mode

Select a course, press one button, get: a final summary, key concepts, flashcards, MCQs with model answers, written questions, and a practice exam — all generated from the actual semester content, all traceable back to source.

The detail that makes this land: **professor-emphasis detection.** When the lecturer says "دي مهمة للامتحان" or "this will be on the exam," Sanad flags that segment, and those flags are weighted heavily in the generated exam. A student can see *"⚑ Flagged — Lecture 6, 34:12: the professor said this would be on the exam."* That is a feature no generic study app has, because no generic study app was in the room.

**Done means:** a generated practice exam where at least one question traces back to a real flagged moment in a real recording.

### 8. 🟢 Study coach with calendar + memory

The student enters exam dates, work shifts, gym, sleep, and preferred study hours. Sanad produces a plan that fits *their* week, not a generic timetable.

Two things make it a coach rather than a calendar:

- **Memory.** A persistent per-topic mastery model — accuracy, exposure, recency — that gets sharper every time the student answers a question. Weak topics get more time automatically.
- **Adaptivity.** Plans rebuild on real events. Finished early and scoring well → it offers the next topic. Struggling late at night after a full day → it tells the student to stop. Missed two days → it re-plans around the deadline instead of showing a wall of red overdue tasks.

The scheduling itself is deterministic code with spaced repetition, not an LLM improvising a timetable. The LLM writes the coaching message; the scheduler decides the slots. Reliability matters more than eloquence here — a plan that double-books the student's exam morning is worse than no plan.

**Done means:** entering a schedule and a set of quiz results produces a visibly different plan for a strong student vs. a weak one.

---

## Stretch — only if the core is finished early

### 9. 🟡 Visual answers (the useful half of the whiteboard)

Skipping the AI video avatar was the right call — it is expensive, slow, and adds nothing a student learns from. But the whiteboard idea has a cheap, high-value core: **let answers render as structures instead of paragraphs.** K-map grids, truth tables, logic-gate diagrams, step-by-step simplifications.

For Digital Logic specifically this is worth a lot and costs little, because these are all renderable from structured output. Only build it after #1–8 are solid.

### 10. 🟡 Offline mode

The honest version: downloaded lectures keep their transcript, summary, flashcards, quizzes, and local text search available with no network. AI chat needs the network.

Full offline AI would mean shipping a local speech model and a local LLM — that is a project in itself, not a feature. Ship the useful 80% and describe it precisely as "downloaded lectures work offline," never as "Sanad works offline." Overclaiming here is the kind of thing a technical judge catches in one question.

### 11. 🟡 Progress tracking and streaks

The mastery data already exists for the coach, so surfacing it is cheap. Keep it to progress and streaks. Points, badges, and leaderboards turn a study tool into a game about the tool — the original instinct to keep this minimal was correct.

---

## Future vision — presented, not built

These are good ideas. They're also the ones that would eat the entire build window and demo badly. They belong on a "what Sanad becomes" slide, described with confidence and no apology.

| Feature | Why it's deferred |
|---|---|
| 🔵 **Student community** | Needs a live student body to look like anything. An empty feed on stage is worse than a slide describing a full one. Also brings moderation, abuse handling, and identity verification — none of which are demoable. |
| 🔵 **TA / instructor dashboard** | Genuinely the strongest *institutional* pitch in the whole vision, and it's what turns Sanad from a student app into something a university buys. But its charts are meaningless without hundreds of students generating real signal. Present it as the business model, powered by data the student side is already collecting. |
| 🔵 **AI FAQ system** | Same dependency: "23 students asked this" requires 23 students. |
| 🔵 **Voice conversation** | Adds real-time audio infrastructure on both ends for something the text answer already does. |
| 🔵 **Multi-language translation (Chinese, etc.)** | Every extra language multiplies the correctness surface we have to verify, for a demo audience that speaks Arabic and English. Say the architecture supports it — it does — and move on. |
| 🔵 **Professor upload portal** | Strong idea, and the natural next step after the TA dashboard: the institution feeds Sanad directly instead of the student capturing it. Needs institutional accounts and permissions to mean anything. |
| 🔵 **AI video avatar** | Highest cost, lowest learning value on the entire list. |

**How to present this section:** it isn't a list of things that didn't fit. It's the second half of the story — Sanad starts with one student in one lecture and grows into the university's academic layer. That framing makes the deferral read as sequencing, not as scope failure.

---

## Decisions made, so nobody relitigates them mid-build

1. **One course.** Digital Logic. Real lecture audio, the real PDF, the real slides. Seeded and verified before demo day.
2. **Two languages.** Arabic and English, including mid-sentence switching. No third language.
3. **Citations are mandatory.** No generated content ships without a source pointer. Anything that can't cite is a bug, not a feature.
4. **Abstention is a feature.** "I couldn't find this in your materials" is correct behavior and gets demoed deliberately.
5. **The scheduler is code, not a prompt.** LLMs write the coaching copy; deterministic logic decides the time slots.
6. **One workspace.** Lecture, transcript, materials, chat, and search live on one screen (vision item #12). This isn't a feature — it's the shell everything else sits in, and it's what makes ten capabilities feel like one product.
7. **No feature ships without a demo beat.** If it doesn't appear in [`demo-script.md`](demo-script.md), it isn't in scope.

---

## What we're actually selling

If the demo works, the judges see this: a professor speaks Arabic and English mixed together, correct technical text appears live, the lecture files itself, the student searches one term and lands on the exact second it was said, asks a question and gets an answer with a citation they can click, then presses one button and gets a practice exam built from what that specific professor emphasized in that specific room.

That is not a chatbot with a university skin. That is a system that was in the lecture.
