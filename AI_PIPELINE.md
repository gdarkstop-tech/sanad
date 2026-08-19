# AI_PIPELINE.md

Every AI pipeline in Sanad: what runs, in what order, with which guarantees.

**Status:** decisions finalized. Not yet implemented — Phase 1 is the foundation only.

**Governing principle:** the LLM is a component, not the system. It never holds state, never decides a schedule, and never produces a user-visible claim the database cannot source. Everything it produces passes through validation written in application code.

---

## 1. Provider abstraction

Five capabilities, five interfaces ([ARCHITECTURE.md](ARCHITECTURE.md) §6). No `packages/core` module imports a vendor SDK; selection is configuration.

```ts
type ProviderConfig = {
  speechToText: { provider: string; model: string; options?: Record<string, unknown> };
  embeddings:   { provider: string; model: string; dimensions: number };
  llm: {
    reasoning:  { provider: string; model: string };  // answers, exam generation
    fast:       { provider: string; model: string };  // per-segment correction, classification
  };
  translation:  { provider: string; model: string };
};
```

Resolution order: **per-course override → environment config → default**. The per-course override exists so the ASR benchmark ([ASR_BENCHMARK.md](ASR_BENCHMARK.md)) can run competing engines through the production code path rather than a parallel harness that drifts from reality.

Two of the five are settled ([ARCHITECTURE.md](ARCHITECTURE.md) §3.8–3.9), both **free and self-hosted on CPU**: speech-to-text is an open-source engine chosen by the Phase 0 benchmark, and embeddings are BGE-M3 at 1024 dimensions, locked. Both stay behind their interfaces; "locked" constrains deployment, not design.

The recurring ASR budget is **$0**, and no paid ASR may be a required dependency. The practical consequence for this pipeline is that **real-time factor now constrains the design**: §2 assumes an engine that keeps ahead of a speaker, and whether any free CPU engine does is exactly what the benchmark measures. The two-tier fallback — fast model live, accurate model on upload — needs no change to anything below.

---

## 2. Live transcription

### Audio capture and preprocessing

Clean audio in is worth more than any correction downstream, so cleanup happens at capture where the signal is best:

```
getUserMedia({ noiseSuppression, echoCancellation, autoGainControl })
  → MediaRecorder → local store (IndexedDB)
```

These constraints are browser-native and free. Where a device does not support them, capture **falls back to plain high-quality recording** rather than failing — a slightly noisier lecture is recoverable, a missing one is not.

Server-side enhancement (denoise, loudness normalization, silence trimming) produces a **derived** audio file: `materials.role='processed'` pointing at its original via `derived_from_material_id` ([DATABASE.md](DATABASE.md) §6). The original is never modified or replaced. ASR runs on the derived version when one exists, and the original remains the archival truth.

### Two capture paths, one pipeline

**Live** streams to ASR during the lecture. **Offline** records locally and uploads later ([ARCHITECTURE.md](ARCHITECTURE.md) §3.10); on arrival it enters the same pipeline in batch mode, producing the same segments, timestamps, confidence, corrections, summaries, and index entries. A lecture recorded on a train with no signal is indistinguishable in the archive from one transcribed live — only the latency differs.

```
mic (16 kHz mono PCM)
  → client-side buffering
  → WebSocket
  → VAD segmentation (Silero)
  → sliding windows: 4 s span, 1 s overlap
  → ASR provider
  ├─ interim  → "draft" event   (rendered grey, never persisted)
  └─ on speech pause → finalize → transcript_segments row (raw_text immutable)
       ├─ term correction   (async) → correction event
       ├─ emphasis detection (async) → emphasis event
       └─ chunk + embed      (job)
```

### Why windowed

Whisper-family models are not streaming models. Overlapping windows approximate streaming; the overlap lets a word split across a boundary be recovered in the next window. Finalization is triggered by a VAD-detected pause, not by the window clock, so segments break at speech boundaries rather than mid-phrase.

### Two-tier display

Draft text renders immediately and is replaced by the finalized, corrected segment. This is the honest representation of a system that is still deciding, and it makes term correction *visible* — a word changing from a transliteration to its canonical form is the pipeline demonstrating itself.

### Confidence

Providers expose confidence differently, so the adapter normalizes to `0..1` and the pipeline bands it:

| Band | Meaning | Effect |
|---|---|---|
| `high` | ≥ 0.85 | Normal rendering |
| `medium` | 0.60–0.85 | Normal rendering; slight retrieval down-weight |
| `low` | < 0.60 | Marked in the UI; down-weighted in retrieval; excluded from generated study content |

Excluding low-confidence spans from flashcards and exam questions is deliberate: a misheard phrase that becomes a flashcard is a wrong fact the student memorizes.

**Thresholds are configuration**, tuned against benchmark results rather than guessed.

### Nothing is destroyed

`raw_text` is written once and never updated. Corrections write `display_text` plus an auditable `term_corrections` row. `GET /lectures/{id}/transcript/raw` always returns the original.

---

## 3. Language handling

**Detection** is per segment, with three outcomes: primary language, `mixed`, or unknown. Unknown is a legitimate result and is stored as null rather than guessed.

**Code-switching is preserved, not normalized.** A mixed sentence stays mixed. The pipeline never rewrites a technical term into the surrounding language, because a transcript that "fixes" mixed speech into monolingual text destroys exactly the information a student needs.

**Translation is additive, configurable, and generated on demand.** The student selects a display language; only that language is produced, then cached ([DATABASE.md](DATABASE.md) §4). Pre-generating every supported language for every segment would multiply cost by the length of the language list for translations nobody opens.

Requesting an uncached language returns the source transcript immediately and enqueues a per-lecture job ([API.md](API.md) §4) — batching by lecture rather than by segment, which is both cheaper and more coherent, since a translator with surrounding context produces better results than one seeing isolated fragments.

The source transcript is always retained. No language pair is privileged in code: Arabic, English, and Chinese are the initial configured set, and a fourth is a config entry plus a provider that supports it.

---

## 4. Technical term correction

Three stages, cheapest first, each with an audit record.

**Stage 1 — recognition-time bias.** The course vocabulary (weighted, top *N* terms) is passed to the recognizer as a bias prompt. Free, no latency, catches the common cases.

**Stage 2 — lexicon matching.** Fuzzy-match segment tokens against `course_vocabulary` and `technical_terms` aliases, using normalized forms (§8) and edit distance tuned per script. High-confidence matches apply directly. Deterministic, fast, and fully explainable — a student can be shown exactly which alias matched.

**Stage 3 — contextual correction.** Remaining low-confidence spans go to the fast LLM with the course vocabulary and the previous two segments as context, returning structured edits with confidence. Async, so it never blocks display.

```
raw segment
  → normalize
  → lexicon match ──── high confidence ──→ apply (method='lexicon')
  → residual spans ──→ LLM with context ──→ apply above threshold (method='llm_context')
                                        └──→ below threshold: store applied=false (suggestion only)
```

Every stage writes a `term_corrections` row: raw term, corrected term, method, confidence, character offsets.

### Bootstrapping a new course

A course with no vocabulary is the normal starting state, and the system must be useful anyway. Vocabulary is **derived from the course's own materials**: term extraction over uploaded PDFs and slides proposes candidates (`source='derived'`), which an instructor or student can accept, edit, or ignore.

This is what makes the course-agnostic claim real rather than aspirational — onboarding a Pharmacology course requires uploading its materials, not writing code or hand-authoring a term list.

---

## 5. Ingestion, chunking, embedding

### Extraction

One extractor per type behind a common interface, so new types are added without touching the pipeline:

```ts
interface Extractor {
  supports(mime: string): boolean;
  extract(ref: StorageRef): Promise<ExtractedUnit[]>;  // text + anchors + language
}
```

| Type | Extractor | Anchor |
|---|---|---|
| PDF (text layer) | PyMuPDF | `page_no` |
| PDF (scanned) | OCR fallback | `page_no` |
| PPT / PPTX | python-pptx, incl. speaker notes | `slide_no` |
| DOC / DOCX | python-docx | `char_offset` |
| Images | OCR | whole-object |
| Audio / video | ASR pipeline (§2) | `t_start_ms` |
| Text | direct | `char_offset` |

**Anchors are produced at extraction time.** There is no later step that adds them — a unit without an anchor cannot be inserted ([DATABASE.md](DATABASE.md) §6).

### Chunking

| Source | Strategy |
|---|---|
| Transcript | Group segments into ~45 s spans on speech boundaries, one segment of overlap |
| Document | Page/slide first, then semantic split at ~400 tokens with ~15% overlap |

Overlap matters: a definition straddling a boundary is a definition retrieval cannot find. Chunking is re-runnable from `material_chunks` and `transcript_segments` without re-extracting files or re-running ASR.

### Embedding

Batched, provider-abstracted, with `embedding_model` and `embedding_dimensions` persisted per row. Text is normalized (§8) before embedding, and `expanded_terms` — canonical vocabulary terms found in the chunk — are written at the same time. Those two columns are what make cross-lingual retrieval work.

---

## 6. Retrieval and grounded answering

**The pipeline is Retrieve → Validate → Generate → Validate Citations → Render.** Never Ask LLM → Display.

### 6.1 Hybrid retrieval

```
query
  → normalize (§8)
  → vocabulary expansion: aliases → canonical terms
  ├─ dense:   pgvector cosine over content_chunks, filtered by offering_id
  └─ lexical: tsvector over text_normalized + expanded_terms array match
  → reciprocal rank fusion
  → rerank top ~30
  → apply confidence weighting (low-confidence ASR chunks down-weighted)
  → top k (default 8)
```

Dense retrieval alone is weak on exact technical tokens; lexical alone fails across languages and paraphrase. RRF needs no score calibration between the two, which is what makes it the right fusion choice here.

### 6.2 Cross-lingual retrieval

Three mechanisms, in increasing specificity:

1. A multilingual embedding model handles general semantic equivalence.
2. **Vocabulary expansion at index time** — every chunk stores canonical terms for the aliases it contains — handles technical terms, where embedding similarity is unreliable.
3. **Query-side expansion** — an Arabic query naming a term stored canonically in English matches through the `expanded_terms` array.

This is why an Arabic query finds English lecture content: not a translation step, but a shared canonical vocabulary on both sides of the index.

### 6.3 The confidence gate

```
if top_fused_score < threshold:      # default 0.35, configurable per course
    return Refusal(reason='below_threshold', suggestions=nearest_topics)
```

**The model is not called.** Refusal is decided before generation, so there is no partial answer to leak and no cost incurred. This is the structural implementation of §10 of the brief.

### 6.4 Generation and citation validation

The model receives only retrieved chunks, each labelled with its ID, and must reference IDs for its claims. Then, in application code:

1. Parse referenced chunk IDs.
2. **Drop any ID not in the retrieved set.** A model cannot invent a citation that survives this step.
3. Resolve each surviving ID to its anchor **from the database row**, never from model output — so a timestamp is always the row's timestamp.
4. If zero citations survive, convert the response to a refusal.
5. Persist `citations` rows with `validated = true` and an anchor snapshot.

Only validated citations reach the client ([API.md](API.md) §7), and `qa_messages.retrieved_chunk_ids` preserves the validation set so any displayed citation can be re-audited afterwards.

### 6.5 Prompt shape

Stable content first (system instructions, course context), volatile content last (retrieved chunks, then the question). This ordering is what makes prompt caching effective across a study session, where the course context is identical for every question. Cache effectiveness is verified from reported cache-read tokens, not assumed.

---

## 7. Emphasis detection

Runs per finalized segment during a live lecture, and in batch over uploaded recordings.

```
segment
  → normalize
  → match against emphasis_cues (rows, per language — never literals in code)
  → candidate? → LLM verification with surrounding context
       ├─ confirmed → lecture_emphasis row (topic linked, quote preserved)
       └─ rejected  → discarded
```

Two stages because cue phrases alone over-trigger: "دي مهمة" also appears in ordinary explanation. Verification asks whether the instructor was marking this as *exam-relevant* given what surrounds it.

The stored record keeps the instructor's actual words and the timestamp, which is what lets the UI show provenance — *"Lecture 6, 34:12 — flagged as exam-relevant"* — and lets the student play the moment.

Cues are seeded per language and are editable data. Adding a dialect, a language, or an instructor's personal phrasing is an insert.

---

## 8. Text normalization

One function, used identically at index time and query time. Divergence here is a silent retrieval failure.

**Arabic:** strip tashkeel and tatweel; normalize `أ إ آ → ا`, `ى → ي`, `ة → ه`; fold Arabic-Indic digits.
**Latin:** lowercase, strip punctuation, collapse whitespace.
**Both:** normalize Unicode to NFC first.

Implemented once in `packages/core/text`, mirrored in the Python tier from the same contract, and covered by shared test vectors so the two implementations cannot drift.

---

## 9. Summaries, topics, and generated study content

### Per lecture (on session close)

```
transcript segments
  → map: per-window key points
  → reduce: lecture summary + keywords
  → topic extraction → study_topics rows (derived, deduplicated against existing course topics)
  → topic_links: chunk ↔ topic
  → flashcards + questions, each with source_chunk_id
```

Topics are **derived per course**, clustered from that course's own content and deduplicated by embedding similarity against existing topics. No topic list exists in code.

### Generation constraints

All generation uses **structured output** with a schema requiring `source_chunk_id`. Items that fail validation are discarded, not repaired — a question whose source cannot be named is a question that cannot be trusted, and `source_chunk_id NOT NULL` means the database refuses it anyway.

Additional rules: low-confidence chunks are excluded from source selection; generated items inherit the language of their source unless the student requests otherwise; and difficulty is estimated at generation time to feed scheduling.

---

## 10. Exam Mode

Batch orchestration, not an interactive request. Latency is irrelevant; quality and grounding are not.

```
course scope
  → gather: lectures, materials, topics, emphasis records, mastery
  → map:    per-lecture summaries + concept extraction        (parallel)
  → reduce: course-level concept graph, repeated-topic detection
  → weight topics:
        base
      × emphasis_weight    (instructor-flagged content)
      × weak_topic_weight  (student's mastery gaps)
      × recency/repetition
  → generate per topic: flashcards, MCQs, short answers, written questions, model answers
  → validate: schema, source presence, duplicate detection
  → assemble exam (exam + exam_items)
```

Both weights come from request config defaulted by the course's `question_profile` ([API.md](API.md) §8) — configuration, not code.

The distinctive output is an exam question traceable to a moment where the instructor said the material was important: `questions.emphasis_id` links it, and the UI can play those seconds of audio.

Non-interactive generation uses batched requests where the provider supports it, at roughly half the cost.

---

## 11. Model selection and cost

Two LLM roles, selected by task shape rather than by habit:

| Role | Used for | Rationale |
|---|---|---|
| **reasoning** | Grounded answers, exam generation, emphasis verification | Read by students and studied from; quality dominates |
| **fast** | Per-segment term correction, language detection, classification | Narrow transforms where per-segment latency dominates |

Initial selection (Claude API; all are replaceable via §1):

| Capability | Choice | Hosting | Cost |
|---|---|---|---|
| Embeddings | **BGE-M3, 1024-d — locked** | Self-hosted, CPU (ONNX int8 for queries) | **$0** |
| ASR | Decided by [ASR_BENCHMARK.md](ASR_BENCHMARK.md) | Self-hosted open-source, CPU | **$0 — required to be** |
| LLM — reasoning | `claude-opus-5` (1M context, $5/$25 per MTok) | Hosted | Per token |
| LLM — fast | `claude-haiku-4-5` (200K, $1/$5 per MTok) | Hosted | Per token |
| Translation | Reasoning model initially | Hosted | On demand only |

Both self-hosted capabilities are free, and both trade money for CPU time — an explicit choice for a project with no infrastructure budget.

**The LLM remains the one paid dependency**, and it is load-bearing: grounded answering, summarization, term correction, emphasis verification, and Exam Mode all run on it. There is no free substitute that preserves the citation guarantees. If the $0 rule is meant to extend beyond ASR, that changes the product rather than the vendor, and should be decided deliberately — see [ARCHITECTURE.md](ARCHITECTURE.md) §11.

### Cost estimate, per lecture

A 50-minute lecture is roughly 12–20K tokens (Arabic tokenizes more heavily than English).

| Stage | Approximate |
|---|---|
| Term correction (fast, per segment) | ~$0.02 |
| Summary + keywords + topics | ~$0.08 |
| Emphasis verification | ~$0.01 |
| Flashcards + questions | ~$0.10 |
| **Per lecture** | **~$0.20** |
| Full course exam pack (batched) | ~$1.50 |
| Grounded answer (cached course context) | a few cents |
| Embeddings | $0 — self-hosted |
| Transcription | **$0** — self-hosted; the cost is CPU time, not money |

Translation is excluded from the per-lecture figure because it is generated only for languages a student actually opens.

A full semester course is a few dollars. **Cost is not a constraint at demo scale**, and engineering time is better spent on transcription accuracy and retrieval quality — the two things that can actually fail visibly.

Structured outputs and native document citations are mutually exclusive in the same request; the PDF-citation path and the structured-generation path therefore stay separate code paths (§6.4, §9).

---

## 12. Deterministic scheduling

**The LLM does not schedule.** It writes one field: `coach_message`.

### Inputs

Availability blocks, blocking commitments, exam dates, per-topic mastery and recency, course workload, session length preferences, and spaced-repetition state.

### Algorithm

```
1. Build free intervals   = declared study windows − work − gym − sleep − classes − commitments
2. Score each topic       = (1 − mastery_score)
                          × exam_urgency(days_to_exam)
                          × decay(days_since_review)
                          × emphasis_weight
3. Sort candidates by score
4. Fill intervals greedily, respecting:
     - minimum and maximum session length
     - maximum daily study minutes
     - spacing between sessions on the same topic
     - interleaving across courses
5. Overlay spaced-repetition reviews at their due times
6. Emit study_sessions
```

### Guarantees (§15 of the brief)

| Rule | Where enforced |
|---|---|
| No double-booking | Scheduler **and** a database `EXCLUDE` constraint ([DATABASE.md](DATABASE.md) §9) |
| No session after the exam | Scheduler: exam time is a hard horizon per course |
| No session in unavailable time | Scheduler: candidate intervals are derived by subtraction |
| No impossible workloads | Scheduler: daily and weekly caps |
| No invalid ranges | `CHECK (ends_at > starts_at)` |

Plans are **reproducible**: `constraints_snapshot` plus `generator_version` regenerate an identical plan with no model call. This is testable, and it is tested.

### Adaptivity

Re-planning is triggered by events, not by a model deciding to change its mind: session completed, session skipped, quiz scored, availability edited, exam date changed, day missed. Two behavioural rules the brief calls for, both implemented as thresholds over the student's own logged data:

- **Enough for today** — when completed minutes reach the daily cap, further sessions are deferred rather than shown as overdue.
- **Momentum** — when recent performance and completion are high, the next topic is offered early.

These describe study workload only. Sanad makes no medical or psychological claims, and the copy is written accordingly.

---

## 13. Mastery updates

Applied transactionally on every graded answer and flashcard review:

```
attempts        += 1
correct         += is_correct ? 1 : 0
accuracy         = correct / attempts
exposure_count  += 1
mastery_score    = w1·accuracy + w2·recency_factor + w3·difficulty_adjusted_performance
confidence       = f(attempts)          # low evidence ⇒ low confidence, not low mastery
is_weak          = mastery_score < weak_threshold AND confidence > min_confidence
last_reviewed_at = now()
```

Separating **mastery** from **confidence in that estimate** prevents the failure where one wrong answer on a fresh topic marks a student "weak" and the scheduler over-corrects on a single data point.

Weights and thresholds are configuration. The whole computation is a pure function — unit-tested, no model involved.

---

## 14. Evaluation

Quality here is a correctness property, so it is tested rather than eyeballed.

| Pipeline | Suite | Gate |
|---|---|---|
| ASR | [ASR_BENCHMARK.md](ASR_BENCHMARK.md) | Phase 0 decision gate |
| Term correction | Labelled segments: precision/recall of applied corrections | No regression in precision |
| Retrieval | Query set with known-correct chunks, incl. Arabic queries for English content | Recall@8, MRR |
| Refusal | Out-of-scope questions per course | **False-answer rate must be 0** |
| Citations | Answers checked for anchor resolvability and quote support | Invalid citation rate 0 |
| Generation | Sample review against sources | Unsourced item rate 0 |
| Scheduler | Property tests over generated constraint sets | No violation of §12 guarantees |

Refusal and citation validity gate releases. A regression there is not a quality dip — it is the product's central claim failing.
