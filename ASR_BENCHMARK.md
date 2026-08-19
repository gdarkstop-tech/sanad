# ASR_BENCHMARK.md

Evaluation protocol for speech recognition, run in **Phase 0 — before the lecture pipeline is built**.

**Status:** proposed, awaiting review.

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

| Candidate | Mode | Notes |
|---|---|---|
| Self-hosted Whisper-family, large multilingual | streaming + batch | Baseline; full control over biasing and configuration |
| Same, with vocabulary biasing enabled | streaming + batch | Isolates the biasing contribution |
| Hosted multilingual ASR API (≥ 1) | as offered | Tests whether hosted accuracy beats controllability |
| Best candidate + LLM correction pass | batch | Isolates [AI_PIPELINE.md](AI_PIPELINE.md) §4 stage 3 |

All candidates run **through the provider interface** ([AI_PIPELINE.md](AI_PIPELINE.md) §1), not through a side harness. Two reasons: the benchmark then measures the real code path including normalization and segmentation, and any candidate can be adopted by changing configuration.

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
| Draft latency p95 | ≤ 3 s | ≤ 2 s |
| Finalization latency p95 | ≤ 8 s | ≤ 5 s |

### Outcomes

**All minimums met** → proceed to Phase 1 with the selected engine.

**Term F1 below minimum but close** → the correction pipeline carries more weight. Proceed with stage 3 ([AI_PIPELINE.md](AI_PIPELINE.md) §4) treated as required rather than optional, and re-benchmark after Phase 4.

**Translation leak or hallucination above ceiling** → reject the candidate outright. These cannot be corrected downstream; they produce fluent text that is wrong about what was said, which is precisely the failure mode Sanad exists to avoid.

**No candidate meets the minimums** → stop and escalate before writing pipeline code. Options in order of preference: a stronger hosted engine; a two-pass design where a fast engine drives the live view and a slower, more accurate one produces the archived transcript; or narrowing the live-transcription claim and leading the product with upload-based ingestion. All three are recoverable in Phase 0 and expensive in Phase 8.

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
4. **Thresholds fixed in advance**, so a result cannot be reinterpreted to fit a preferred conclusion.
5. **Both sides measured.** Biasing and correction are evaluated by their delta against the same baseline, so their real contribution is known rather than assumed.
6. **Consent and retention.** Speaker permission is recorded before use, and benchmark audio follows the same retention policy as student recordings ([ARCHITECTURE.md](ARCHITECTURE.md) §11.5). This needs an answer before collection begins.
