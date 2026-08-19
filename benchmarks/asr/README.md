# ASR benchmark harness

Implements the protocol in [ASR_BENCHMARK.md](../../ASR_BENCHMARK.md). Runs on
Python 3.11+ with **no third-party dependencies** — the metrics are stdlib only,
so the harness works on any machine, including one where no ASR engine is
installed.

## Status

Harness implemented and self-tested (52 tests). **Awaiting audio** — roughly 30
minutes from two unrelated disciplines.

## Commands

```bash
cd benchmarks/asr

python3 run.py --check         # which engines are installed
python3 run.py --self-test     # verify the metrics before trusting them
python3 -m unittest discover -p "test_*.py"

python3 run.py --dataset dataset/manifest.json --engine faster-whisper-small
```

## Why the metrics are shaped this way

**Technical-term F1 is primary; word error rate is supporting evidence.** A
transcript can post a respectable WER while getting every technical term wrong,
because terms are a small share of tokens and most of the meaning.
`test_scoring.py` contains that exact case as an executable demonstration:
8 of 9 tokens correct, and the transcript is useless for retrieval.

**Real-time factor is a decision gate**, not a footnote. The ASR budget is $0
and there is no GPU, so the question "can any free CPU engine keep ahead of a
speaker" decides whether Sanad has a live tier at all.

**Translation leak is a rejection**, not a score. Whisper-family models
sometimes translate rather than transcribe at a language switch; the output is
fluent, plausible, and wrong about what was said. Nothing downstream can repair
it.

**Two unrelated disciplines are required.** `dataset.py` refuses to load a
single-discipline manifest. A benchmark on one subject measures how well an
engine knows that subject and cannot detect a result that collapses on another —
which is precisely the claim Sanad makes.

## Adding an engine

1. Declare it in `engines.py` (`module` or `binary` for availability detection).
2. Write an adapter of type `engines.Transcriber`: audio path → `[{start_ms, end_ms, text, confidence?}]`.
3. Call `run.run_with(dataset, engine, adapter, out_dir)`.

Adapters are supplied by the caller, so the harness never hard-depends on an
engine. In the product these live behind `SpeechToTextProvider`
([AI_PIPELINE.md](../../AI_PIPELINE.md) §1), and the benchmark drives the same
interface so it measures the real code path.

**A paid engine cannot be selected.** `engines.assert_free()` raises on anything
marked `paid`, and it is called on every run.

## Files

| File | Purpose |
|---|---|
| `normalization.py` | Mirrors `packages/core/src/text.ts`; both pinned to `shared/text-normalization-vectors.json` |
| `scoring.py` | All metrics from ASR_BENCHMARK.md §4 |
| `dataset.py` | Manifest loading and validation |
| `engines.py` | Candidate registry, availability detection, budget gate |
| `run.py` | CLI, scoring pipeline, threshold gates, report generation |
| `ANNOTATION_GUIDE.md` | Rules for producing reference transcripts |
| `dataset/manifest.example.json` | Manifest shape |

Audio is never committed. Results land in `results/<engine>/`, with raw
hypotheses kept so any published number can be re-derived.
