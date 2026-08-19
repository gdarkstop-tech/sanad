# ASR_BENCHMARK.md

Evaluation protocol for speech recognition, run in **Phase 0 — before the lecture pipeline is built**.

**Status:** budget set to **$0 recurring**; candidates are free/open-source (§5). Harness implemented and self-tested; awaiting audio.

---

## 1. Why this runs first

Every capability in Sanad reads from the transcript. Search indexes it, retrieval scores it, answers cite it, summaries compress it, questions are generated from it, and mastery is measured against topics derived from it. If code-switched technical transcription is not good enough, nothing downstream can compensate — a retrieval system cannot find a term that was never recognized.

This is therefore a **decision gate, not a measurement exercise**. Its output is a choice: which engine, which configuration, and whether the approach in [ARCHITECTURE.md](ARCHITECTURE.md) §3.2 survives contact with real audio.

Discovering this in Phase 0 costs days. Discovering it in Phase 8 costs the project.

---

## 2. What is being measured

**Generic Word Error Rate is not the primary metric** (§25 of the brief). A transcript can post a respectable overall WER while getting every technical term wrong, because technical terms are a small fraction of tokens and a large fraction of meaning. Overall WER would then report success on a transcript that is useless for retrieval.

The primary metric is **technical-term accuracy**. Everything else is supporting evidence.

---

## 3. Dataset

### Requirements

| Property | Requirement |
|---|---|
| Duration | ≥ 30 minutes of real university lecture audio |
| Subjects | **At least two unrelated disciplines** |
| Languages | Arabic, English, and genuine mid-sentence code-switching |
| Terminology | Dense technical vocabulary in each subject |
| Delivery | Varied speaking rates, including fast passages |
| Conditions | Real rooms — reverberation, background noise, imperfect microphones |
| Consent | Recorded and used with the speaker's permission |

**Two disciplines is a hard requirement, not a nice-to-have.** A benchmark on one subject measures how well an engine handles *that* subject's vocabulary. Sanad's central claim is that it works for any course, so the benchmark must be able to detect a result that holds for one discipline and collapses for another. Any demo course may serve as one of the two; neither may be the only one.

### Composition

| Segment | Duration | Purpose |
|---|---|---|
| A | ~10 min | Discipline 1, Arabic-dominant with English technical terms |
| B | ~10 min | Discipline 2 (unrelated), same pattern |
| C | ~5 min | English-dominant with Arabic asides |
| D | ~3 min | Fast delivery |
| E | ~2 min | Poor acoustics — back of room, noise |

Segments D and E are deliberately adversarial. An engine that only performs on clean, measured speech will fail in an actual lecture hall.

### Reference transcripts

Human-produced, following a written annotation guide, with a second annotator on a 20% sample to establish inter-annotator agreement. Annotation rules must be fixed **before** transcribing, because ambiguity discovered later invalidates comparisons:

- Code-switched speech is transcribed **as spoken** — mixed script, never normalized to one language.
- Technical terms are marked with span annotations and a canonical form.
- Disfluencies are marked but excluded from WER.
- Timestamps are recorded at every utterance boundary.
- Uncertain audio is marked `[unclear]` and excluded from scoring.

Stored under `benchmarks/asr/dataset/` with a manifest; audio itself is not committed to Git.

---

## 4. Metrics

### 4.1 Primary — technical-term accuracy

Terms are annotated in the reference. For each, the hypothesis is checked against its canonical form and accepted aliases.

```
term_recall    = correctly recognized terms / reference terms
term_precision = correctly recognized terms / hypothesis terms
term_f1        = harmonic mean
```

Reported **overall, per language, and per discipline**. Cross-discipline variance is itself a finding: a large gap means the engine's performance depends on domain familiarity, which affects how much vocabulary biasing the product must do.

Measured twice: **without** vocabulary biasing and **with** it. The delta quantifies what [AI_PIPELINE.md](AI_PIPELINE.md) §4 buys, and whether it is worth its complexity.

### 4.2 Language and code-switching

| Metric | Definition |
|---|---|
| Arabic WER | WER over Arabic-only reference regions |
| English WER | WER over English-only regions |
| Code-switch boundary accuracy | Fraction of switch points where both sides are correctly rendered in the right script |
| Script fidelity | Fraction of terms rendered in the script actually spoken |

Code-switch boundary accuracy is where engines diverge most, and it is invisible in an aggregate WER number.

### 4.3 Translation leak — a hard gate

Whisper-family models sometimes **translate instead of transcribing** at a language switch. The failure is quiet: the output is fluent, plausible, and wrong about what was said.

```
translation_leak_rate = segments translated rather than transcribed / total segments
```

Detected by checking whether reference-Arabic regions were emitted in English, or vice versa. **Ceiling: 1%.** An engine above it is rejected regardless of every other score, because a transcript that silently paraphrases across languages cannot support citations.

### 4.4 Hallucination

Whisper-family models emit fabricated text over silence and noise.

```
insertion_rate      = inserted words / reference words
silence_hallucination = fabricated tokens emitted during annotated silence
```

Segment E and inserted silence padding test this specifically. Hallucinated transcript text becomes hallucinated search results and fabricated citations — a direct attack on the product's core claim.

### 4.5 Timestamps

```
boundary_error_ms  = |hypothesis_start − reference_start|, reported as median and p95
alignment_accuracy = fraction of segments within ±500 ms
```

Timestamps are citation anchors. A citation that jumps to the wrong place is worse than no citation, because it destroys trust in every citation the student has not personally verified.

### 4.6 Latency and cost

| Metric | Definition |
|---|---|
| Draft latency | Speech → first interim text (p50, p95) |
| Finalization latency | Speech pause → finalized segment (p50, p95) |
| Real-time factor | Processing time ÷ audio duration, batch mode |
| Cost per hour | Hosted API price, or GPU-hours for self-hosted |

### 4.7 Confidence calibration

Does reported confidence predict actual error? Bucket segments by confidence and measure WER per bucket.

An engine whose confidence is uncorrelated with accuracy cannot support the low-confidence marking in [AI_PIPELINE.md](AI_PIPELINE.md) §2 — and the product would be showing students a reliability signal that means nothing.

---

## 5. Systems under test

**Budget: $0 recurring. No paid ASR may be a required dependency.** Combined with the absence of GPU hardware, that makes the candidate set open-source models running on commodity CPU.

### The constraint this creates, stated plainly

$0 + no GPU + **low-latency live transcription** is the hard combination. On CPU, the accurate Whisper-family models are unlikely to run faster than real time, and a model that cannot keep up with a speaker cannot drive a live transcript.

This is not a reason to change the architecture now, and §7 is written so the benchmark decides it rather than an assumption. Two things make it survivable:

1. **The offline capture path already exists.** Sanad was designed so a lecture recorded without a network is uploaded later and processed in batch, arriving in the archive identical to a live one ([AI_PIPELINE.md](AI_PIPELINE.md) §2). If real-time proves impossible at $0, the product degrades to *record now, transcript ready shortly after* — a smaller claim, not a broken one.
2. **Two-pass is a real design, not a consolation.** A small fast model drives the live view; a larger accurate one produces the archived transcript afterwards. Both can be free.

What the benchmark must therefore measure, and did not need to before, is **real-time factor on target hardware** (§4.6).

### Candidates

| Candidate | Mode | Cost | Notes |
|---|---|---|---|
| `whisper.cpp`, quantized ggml (`tiny`, `base`, `small`) | batch + near-live | $0 | Fastest CPU path; the realistic live candidates |
| `whisper.cpp`, quantized (`medium`, `large-v3-turbo`) | batch | $0 | Accuracy ceiling for CPU batch |
| `faster-whisper` / CTranslate2, int8 (`small`, `medium`, `large-v3-turbo`) | batch | $0 | Usually the best CPU accuracy-per-second |
| Vosk, Arabic + English models | streaming | $0 | Built for low-resource streaming; weaker on technical terms — include it precisely to find out how much weaker |
| In-browser WASM (Transformers.js, `whisper-base`/`small`) | client-side | $0 | Zero server cost entirely; bounded by the student's device |
| Best free candidate + vocabulary biasing (`initial_prompt`) | as above | $0 | Isolates stage 1 of term correction ([AI_PIPELINE.md](AI_PIPELINE.md) §4) |
| Best free candidate + LLM correction pass | batch | LLM tokens only | Isolates stage 3 |
| Free-tier hosted API | reference only | $0 within tier | **Never a required dependency.** Measured to know what is being given up; adoptable only as an optional accelerator a deployment may enable |

Self-hosted models expose `initial_prompt`, so **vocabulary biasing is available on every real candidate** — which was uncertain under the hosted plan and is now a genuine advantage of going open-source.

All candidates run **through the provider interface** ([AI_PIPELINE.md](AI_PIPELINE.md) §1), not through a side harness. The benchmark then measures the real code path including normalization and segmentation, and any candidate can be adopted by changing configuration.

Every run pins `task=transcribe` explicitly (§4.3).

---

## 6. Procedure

1. **Freeze** the dataset, annotation guide, and metric implementations.
2. Verify the harness against a synthetic known-answer case — a metric bug that flatters one candidate is worse than no benchmark.
3. Run each candidate over all five segments, three runs each where the engine is non-deterministic.
4. Record raw hypotheses, timings, and confidence values under `benchmarks/asr/results/<candidate>/<run>/`.
5. Score with the shared implementation; no per-candidate special handling.
6. Report medians with variance across runs.
7. Record the decision and its rationale in `benchmarks/asr/DECISION.md`.

The harness lives in `benchmarks/asr/` and stays in the repository as a regression suite: the same protocol re-runs when a provider or model changes.

---

## 7. Decision thresholds

Proposed for review, to be confirmed before the run so results cannot be rationalized after the fact:

| Metric | Minimum | Target |
|---|---|---|
| Technical-term F1 (with biasing) | 0.75 | 0.88 |
| Technical-term F1 gap between disciplines | ≤ 0.15 | ≤ 0.08 |
| Arabic WER | ≤ 0.35 | ≤ 0.22 |
| English WER | ≤ 0.25 | ≤ 0.15 |
| Code-switch boundary accuracy | 0.70 | 0.85 |
| **Translation leak rate** | **≤ 0.01** | 0 |
| Silence hallucination | ≤ 0.02 | 0 |
| Timestamp alignment (±500 ms) | 0.90 | 0.97 |
| **Recurring cost per audio hour** | **$0** | $0 |
| Real-time factor, live candidate (CPU) | ≤ 0.7× | ≤ 0.4× |
| Real-time factor, batch candidate (CPU) | ≤ 3× | ≤ 1× |
| Peak memory | ≤ 4 GB | ≤ 2 GB |
| Draft latency p95 *(live tier only)* | ≤ 3 s | ≤ 2 s |
| Finalization latency p95 *(live tier only)* | ≤ 8 s | ≤ 5 s |

**Cost is now a gate, not a criterion.** A candidate with a recurring per-hour price is disqualified as a *required* dependency regardless of accuracy. It may still be measured, and may be offered as an optional accelerator, but the product must be complete and demonstrable without it.

**Real-time factor is the new decisive metric.** RTF ≤ 0.7× means the engine keeps ahead of a speaker with headroom for the correction pass; above 1× it cannot drive a live transcript at all, however accurate it is. Batch tolerates up to 3× — a 50-minute lecture processed in under two and a half hours is acceptable for work that happens after the lecture ends.

Measure RTF on a defined commodity machine (record core count and model), single stream, no GPU. Record the machine in the report: an RTF without its hardware is not a number.

### Outcomes

**A candidate meets the accuracy minimums and the live RTF** → single-tier design. Live and batch use the same engine.

**Accuracy minimums met, but no candidate reaches live RTF** → **two-tier design**: the fastest acceptable model drives the live view, the most accurate one produces the archived transcript on upload. Expected outcome, and already compatible with the pipeline as designed.

**Accuracy minimums met only in batch** → live transcription is dropped from the MVP claim and the product leads with capture-then-process. The offline path makes this a change of promise, not of architecture. Say it plainly rather than demoing a live transcript that only works on rehearsed audio.

**Term F1 below minimum but close** → the correction pipeline carries more weight. Proceed with stage 3 ([AI_PIPELINE.md](AI_PIPELINE.md) §4) treated as required rather than optional, and re-benchmark after Phase 4.

**Translation leak or hallucination above ceiling** → reject the candidate outright. These cannot be corrected downstream; they produce fluent text that is wrong about what was said, which is precisely the failure mode Sanad exists to avoid.

**No candidate meets the accuracy minimums** → stop and escalate before writing pipeline code. Options, in order: in-browser WASM transcription, which moves compute to the student's device and stays at $0; raising the LLM correction pass from optional to required, accepting its token cost and measuring the corrected output rather than the raw; or revisiting the $0 constraint with evidence of exactly what it costs in accuracy. All are recoverable in Phase 0 and expensive in Phase 8.

---

## 8. Reporting

`benchmarks/asr/results/report.md`, plus machine-readable results:

```json
{
  "candidate": "…",
  "run": 1,
  "dataset_version": "…",
  "overall": { "wer": 0.0, "term_f1": 0.0 },
  "by_language": { "ar": { "wer": 0.0 }, "en": { "wer": 0.0 } },
  "by_discipline": { "discipline_1": { "term_f1": 0.0 }, "discipline_2": { "term_f1": 0.0 } },
  "code_switch": { "boundary_accuracy": 0.0, "script_fidelity": 0.0 },
  "integrity": { "translation_leak_rate": 0.0, "insertion_rate": 0.0, "silence_hallucination": 0.0 },
  "timestamps": { "median_error_ms": 0, "p95_error_ms": 0, "within_500ms": 0.0 },
  "latency": { "draft_p50_ms": 0, "draft_p95_ms": 0, "final_p50_ms": 0, "final_p95_ms": 0 },
  "confidence_calibration": [ { "bucket": "0.9-1.0", "wer": 0.0, "n": 0 } ],
  "cost": { "usd_per_audio_hour": 0.0 }
}
```

The report must state what was measured, on what audio, with which configuration — and the raw hypotheses must be kept so any number can be re-derived. A benchmark whose results cannot be reproduced is an opinion with a table around it.

---

## 9. Guardrails

1. **Subject-independent.** Metrics, harness, and annotation guide contain no subject-specific logic. Adding a third discipline is adding data.
2. **No hard-coding.** The term list per discipline is data under `benchmarks/asr/dataset/`, loaded at run time, and covered by the CI course-agnostic check.
3. **Real audio only.** Synthetic or studio-clean recordings flatter every engine and hide exactly the failures that matter in a lecture hall.
3a. **No paid dependency in the chosen path.** A free-tier service may be measured, but the selected configuration must run at $0 indefinitely, with no trial window and no per-hour rate.
4. **Thresholds fixed in advance**, so a result cannot be reinterpreted to fit a preferred conclusion.
5. **Both sides measured.** Biasing and correction are evaluated by their delta against the same baseline, so their real contribution is known rather than assumed.
6. **Consent and retention.** Speaker permission is recorded before use, and benchmark audio follows the same retention policy as student recordings ([ARCHITECTURE.md](ARCHITECTURE.md) §11.5). This needs an answer before collection begins.
