# Live transcription — decision

**Decision: Sanad does not offer live transcription in the MVP.**

The product is presented as **offline lecture recording with automatic AI transcription**: the recording is captured on the device with no network, uploaded when connectivity returns, and transcribed automatically on the server. Transcription is available shortly after the lecture, not during it.

This is a deliberate choice, made against a rule fixed before any result existed.

---

## 1. The decision rule, stated in advance

[ASR_BENCHMARK.md](../ASR_BENCHMARK.md) §7 pre-commits the thresholds a live tier must clear, so a result could not be reinterpreted afterwards to fit a preferred conclusion. The relevant one is the real-time factor: an engine claiming a `live` tier must transcribe audio faster than it arrives, on the hardware it will actually run on, with headroom.

The rule is therefore: **live transcription ships only if a candidate clears the `live` gate on Sanad's own audio, on CPU, at $0.**

## 2. Why the rule was not met

It was not met because it was **not evaluated**. As of this writing:

- No consented lecture audio exists in `benchmarks/asr/dataset/`, so the benchmark has not been run — see [ASR_BENCHMARK.md](../ASR_BENCHMARK.md) §10, **Benchmark pending real audio**.
- `python3 run.py --check` reports **1 of 10** candidate engines installed in this environment, and the one present (`transformers-js-base`) is the `client` tier, not `live`.
- The environment has **no GPU**, and the budget is **$0 recurring** with no paid ASR permitted as a required dependency.

An unmeasured engine cannot clear a gate. Shipping live transcription now would mean asserting a real-time factor nobody has measured, on hardware nobody has tested, for a claim a judge could check in ten seconds by watching the screen during a demo.

## 3. Why this is not a downgrade

The feature students actually need is not "words on screen while the professor talks." It is **not losing the lecture**, and **being able to search and question it afterwards**. Recording-first delivers that, and delivers something live transcription on its own does not:

| | Live transcription | Recording + automatic transcription |
|---|---|---|
| Works with no signal in a lecture hall | No — needs a live connection | **Yes** — capture is entirely local |
| Survives the app being killed mid-lecture | Loses the stream | **Yes** — resumes by byte offset |
| Costs $0 with no GPU | Unproven | **Yes** — batch CPU has no latency budget |
| Produces citable timestamps | Yes | **Yes** |
| Can use a slower, more accurate model | No — bounded by real time | **Yes** |

The last row is the substantive one. A batch pipeline can spend ten seconds on a minute of audio and use a larger model; a live pipeline cannot. For code-switched Arabic/English technical speech — the hardest case Sanad has, and the one every downstream feature depends on — accuracy matters more than immediacy. A wrong term transcribed instantly is worse than a right term transcribed four minutes later, because retrieval cannot find a term that was never recognized.

## 4. What is actually implemented

- Recording on device with no network, queued locally, uploaded resumably and idempotently (`packages/offline`, 23 tests).
- Server-side transcription as a queued job behind `AsrProvider`, with `FixtureAsrProvider` for development and `WhisperCppProvider` for a real binary.
- Per-segment timestamps, language and code-switch detection, and confidence bands, so every downstream citation points at a real moment in the audio.
- Processing status surfaced to the student: `uploaded → processing → ready`, with failures shown and their reason given.

## 5. How to say it in the demo

> "Sanad records the lecture even with no signal, then transcribes it automatically once you're back online."

Not: "Sanad transcribes your lecture live." That is not what it does.

## 6. What would reverse this decision

Exactly one thing: running the benchmark on real audio and having a free, CPU-viable engine clear the `live` gate in §7. The architecture already allows it — `AsrProvider` is an interface, the recording path is unchanged, and a streaming provider would add a tier rather than replace anything. Until that measurement exists, the claim does not.
