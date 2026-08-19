# Build plan

Ordering principle: **de-risk first, polish last.** The riskiest assumption in Sanad is that code-switched Arabic/English technical transcription is good enough to build a product on. Test that in the first days, not the last — everything else is standard engineering that we know will work.

---

## Milestone 0 — Prove the risky part

Nothing else starts until this is answered.

- Collect 30+ minutes of **real** Digital Logic lecture audio with natural Arabic/English mixing.
- Bake off `large-v3-turbo` against one hosted alternative. Measure word error rate **on technical terms specifically**, not overall WER — overall WER will look fine while every term you care about is wrong.
- Seed ~80 Digital Logic glossary terms with Arabic transliterations.
- Measure the lift from glossary biasing.
- Verify Whisper isn't silently translating instead of transcribing on language switches.

**Exit criterion:** technical terms land correctly often enough that the corrected output is visibly better than raw output on the same audio. If it doesn't, we find out now — while there's still time to change approach.

---

## Milestone 1 — The spine

Everything downstream depends on chunks with citation anchors existing.

- Postgres + pgvector, `chunks` schema with anchors from day one.
- Ingestion: audio → transcript → chunks; PDF/PPTX → chunks.
- Hybrid search: dense + BM25 with Arabic normalization + RRF.
- Glossary term expansion at index time (this is what makes cross-lingual search work).
- Seed all twelve lectures plus course materials.

**Exit criterion:** `خريطة كارنوف` returns the English K-map lecture segment.

---

## Milestone 2 — The product

- Live transcription with two-tier grey/black display and confidence marking.
- Auto-archive on recording stop.
- Grounded Q&A: retrieval gate → cited answer → citation validation → clickable timestamps.
- **The refusal path**, tested explicitly with out-of-scope questions.
- Unified workspace shell — lecture, transcript, materials, search, and chat on one screen.

**Exit criterion:** ask a question, click a citation, hear the professor say it.

---

## Milestone 3 — Study and exam

- Per-lecture summaries, key concepts, professor-emphasis detection.
- Exam Mode pack via batch: flashcards, MCQs, written questions, practice exam, model answers.
- Structured output with required `source_chunk_id`; validation drops unsourced items.
- Mastery table, updated from every answer.
- Calendar input and deterministic scheduler with FSRS review interleaving.

**Exit criterion:** a generated exam question traces to a real flagged moment in a real recording.

---

## Milestone 4 — Demo hardening

This milestone is not optional and teams always underestimate it.

- Run [`demo-script.md`](demo-script.md) end to end, timed, repeatedly.
- Pre-test every query, question, and citation click that appears in the demo.
- Record the full-flow fallback video.
- Fix only what breaks the demo. **No new features.**
- Stretch items (visual answers, offline caching, progress UI) get built here *only* if everything above is genuinely done.

---

## Three parallel tracks

| Track | Owns |
|---|---|
| **Speech** | ASR pipeline, glossary, correction, confidence, streaming |
| **Knowledge** | Ingestion, chunking, embeddings, hybrid search, grounded answering, Exam Mode |
| **Product** | Workspace UI, archive, player + citation navigation, coach, plan |

The two interfaces that let these run independently, both frozen at the end of Milestone 1:

1. **`chunks`** — the contract between Speech/Knowledge and everything else.
2. **The citation object** — `{source_id, t_start_ms | page_no, confidence}`. Every layer speaks this.

Freeze those two early and the tracks stop blocking each other.

---

## Things that will cost time if not decided now

- **Real lecture audio.** Get it in week one. Synthetic or clean-studio audio will make the ASR look better than it is and hide problems until demo day.
- **The glossary.** One afternoon of manual work, highest leverage in the project. Don't defer it as "polish" — it's load-bearing for both transcription and cross-lingual search.
- **Arabic text normalization.** Decide the rules once (tashkeel, alef, ya, ta marbuta), apply identically at index and query time. Mismatched normalization is a silent retrieval killer that's miserable to debug later.
- **Citation UI.** Clicking a citation and landing on the exact second is the demo's most-repeated interaction. Build it properly the first time.

---

## The rule

The blue list in [`product-scope.md`](product-scope.md) does not get built. Not "if there's time" — the honest answer is there won't be, and every hour spent on an empty community feed is an hour not spent on transcription accuracy, which is the thing that can actually lose the competition on stage.
