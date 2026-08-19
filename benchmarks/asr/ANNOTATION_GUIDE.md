# Annotation guide

Rules are fixed **before** transcription begins. Ambiguity discovered halfway
through invalidates every comparison made with the earlier half, so this
document is frozen at the same time as the dataset.

## What to record

For each segment, split the reference into utterances at natural pauses, and for each:

| Field | Rule |
|---|---|
| `start_ms` / `end_ms` | Utterance boundaries, to the nearest 100 ms. Segments must not overlap and must be in order. |
| `language` | `ar`, `en`, or `mixed`. Use `mixed` for genuine mid-sentence switching. |
| `text` | Exactly what was said. |
| `terms` | Every technical term occurrence, with its canonical form and accepted aliases. |
| `silence` | `true` for annotated silence. Leave `text` empty. |

## Transcription rules

1. **Transcribe as spoken, never normalized to one language.** «الـ widget-latch بيخزن bit واحد» is written exactly that way. Rewriting it into pure Arabic or pure English destroys the thing being measured.
2. **Keep the script that was spoken.** A term said in English is written in Latin script even inside an Arabic sentence.
3. **Mark disfluencies** ("uh", "يعني" as filler) with `[dis]` around them. They are excluded from word error rate.
4. **Mark unclear audio** `[unclear]`. Those spans are excluded from scoring entirely — a human who cannot make out the audio is not a fair reference for a machine.
5. **Numbers as spoken.** "twenty five" if said in words, "25" if said as a figure.
6. **No punctuation beyond sentence boundaries.** Punctuation is normalized away before scoring, and inconsistent punctuation wastes annotator effort.

## Annotating terms

A term is any subject-specific vocabulary item whose accuracy a student would
notice. Record:

- `canonical`: the standard written form, in the language it is normally written in.
- `aliases`: other renderings that should count as **correct**, including transliterations into the other script.

Aliases exist because the reference records what was *said*, while a correct
transcript may legitimately render it in either script. They are not a list of
mistakes to forgive — a genuinely wrong word is never an alias.

## Quality control

- A second annotator independently transcribes **20%** of the audio.
- Compute inter-annotator agreement on that sample before scoring any engine. Low agreement means the guide is ambiguous, not that one annotator is wrong.
- Disagreements are resolved by amending this guide, then re-annotating.

## Consent

Recording and use permission is obtained and recorded **before** any audio is
collected, covering benchmark use specifically ([ARCHITECTURE.md](../../ARCHITECTURE.md) §9).
Audio files are never committed to the repository — only this manifest and the
reference text.
