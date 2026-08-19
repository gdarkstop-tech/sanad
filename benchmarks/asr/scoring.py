"""ASR benchmark metrics (ASR_BENCHMARK.md section 4).

Generic word error rate is deliberately NOT the primary metric: a transcript
can post a respectable WER while getting every technical term wrong, because
terms are a small share of tokens and a large share of meaning.

Nothing here is subject-specific. Terms, aliases, and language tags all come
from the dataset.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from normalization import normalize_for_search, script_of, tokenize


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Term:
    """A technical term occurrence annotated in the reference."""

    canonical: str
    aliases: tuple[str, ...] = ()

    def surface_forms(self) -> list[str]:
        return [normalize_for_search(f) for f in (self.canonical, *self.aliases) if f.strip()]


@dataclass(frozen=True)
class RefSegment:
    start_ms: int
    end_ms: int
    text: str
    language: str  # 'ar' | 'en' | 'mixed'
    terms: tuple[Term, ...] = ()
    is_silence: bool = False


@dataclass(frozen=True)
class HypSegment:
    start_ms: int
    end_ms: int
    text: str
    confidence: float | None = None


@dataclass
class EditCounts:
    substitutions: int = 0
    deletions: int = 0
    insertions: int = 0
    reference_length: int = 0

    @property
    def error_rate(self) -> float:
        if self.reference_length == 0:
            return 0.0 if (self.substitutions + self.insertions) == 0 else 1.0
        total = self.substitutions + self.deletions + self.insertions
        return total / self.reference_length


# --------------------------------------------------------------------------
# 4.2 Word error rate
# --------------------------------------------------------------------------


def align(reference: Sequence[str], hypothesis: Sequence[str]) -> EditCounts:
    """Levenshtein alignment over tokens, returning the S/D/I breakdown.

    The breakdown matters: deletions and insertions mean different things here.
    A high insertion count is the signature of hallucination (4.4), not of
    ordinary transcription error.
    """
    n, m = len(reference), len(hypothesis)
    # dp[i][j] = (cost, subs, dels, ins) for reference[:i] vs hypothesis[:j]
    dp: list[list[tuple[int, int, int, int]]] = [
        [(0, 0, 0, 0)] * (m + 1) for _ in range(n + 1)
    ]
    for j in range(1, m + 1):
        dp[0][j] = (j, 0, 0, j)
    for i in range(1, n + 1):
        dp[i][0] = (i, 0, i, 0)

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if reference[i - 1] == hypothesis[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
                continue
            sub_c, sub_s, sub_d, sub_i = dp[i - 1][j - 1]
            del_c, del_s, del_d, del_i = dp[i - 1][j]
            ins_c, ins_s, ins_d, ins_i = dp[i][j - 1]
            best = min(
                (sub_c + 1, sub_s + 1, sub_d, sub_i),
                (del_c + 1, del_s, del_d + 1, del_i),
                (ins_c + 1, ins_s, ins_d, ins_i + 1),
                key=lambda t: t[0],
            )
            dp[i][j] = best

    _, subs, dels, ins = dp[n][m]
    return EditCounts(subs, dels, ins, n)


def word_error_rate(reference_text: str, hypothesis_text: str) -> EditCounts:
    return align(tokenize(reference_text), tokenize(hypothesis_text))


def wer_by_language(
    refs: Sequence[RefSegment], hyps: Sequence[HypSegment], language: str
) -> EditCounts:
    """WER restricted to reference regions of one language."""
    total = EditCounts()
    for ref in refs:
        if ref.language != language or ref.is_silence:
            continue
        counts = word_error_rate(ref.text, _hypothesis_overlapping(ref, hyps))
        total.substitutions += counts.substitutions
        total.deletions += counts.deletions
        total.insertions += counts.insertions
        total.reference_length += counts.reference_length
    return total


# --------------------------------------------------------------------------
# 4.1 Technical-term accuracy — the primary metric
# --------------------------------------------------------------------------


@dataclass
class TermScore:
    matched: int = 0
    reference_total: int = 0
    hypothesis_total: int = 0

    @property
    def recall(self) -> float:
        return self.matched / self.reference_total if self.reference_total else 0.0

    @property
    def precision(self) -> float:
        return self.matched / self.hypothesis_total if self.hypothesis_total else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if (p + r) else 0.0


def _contains(haystack_tokens: Sequence[str], needle: str) -> bool:
    needle_tokens = needle.split()
    if not needle_tokens:
        return False
    span = len(needle_tokens)
    return any(
        list(haystack_tokens[i : i + span]) == needle_tokens
        for i in range(len(haystack_tokens) - span + 1)
    )


def term_score(refs: Sequence[RefSegment], hyps: Sequence[HypSegment]) -> TermScore:
    """Recall, precision and F1 over annotated technical terms.

    A term counts as recognized if the hypothesis contains its canonical form
    or any accepted alias, after normalization. Aliases exist because the
    reference records what was *said*, and a correct transcript may legitimately
    render it in either script.
    """
    score = TermScore()
    for ref in refs:
        if not ref.terms:
            continue
        hyp_tokens = tokenize(_hypothesis_overlapping(ref, hyps))
        for term in ref.terms:
            score.reference_total += 1
            forms = term.surface_forms()
            if any(_contains(hyp_tokens, form) for form in forms):
                score.matched += 1
                score.hypothesis_total += 1

    # Terms the hypothesis asserts where the reference has none: false positives
    # that would otherwise inflate precision.
    score.hypothesis_total += _spurious_term_count(refs, hyps)
    return score


def _spurious_term_count(refs: Sequence[RefSegment], hyps: Sequence[HypSegment]) -> int:
    vocabulary: dict[str, Term] = {}
    for ref in refs:
        for term in ref.terms:
            for form in term.surface_forms():
                vocabulary[form] = term

    spurious = 0
    for ref in refs:
        expected = {f for term in ref.terms for f in term.surface_forms()}
        hyp_tokens = tokenize(_hypothesis_overlapping(ref, hyps))
        for form in vocabulary:
            if form in expected:
                continue
            if _contains(hyp_tokens, form):
                spurious += 1
    return spurious


# --------------------------------------------------------------------------
# 4.2 Code-switching
# --------------------------------------------------------------------------


def code_switch_boundary_accuracy(
    refs: Sequence[RefSegment], hyps: Sequence[HypSegment]
) -> float:
    """Fraction of language-switch points rendered correctly on both sides.

    Invisible in an aggregate WER number, and where engines diverge most.
    """
    boundaries = 0
    correct = 0
    speech = [r for r in refs if not r.is_silence]

    for previous, current in zip(speech, speech[1:]):
        if previous.language == current.language:
            continue
        boundaries += 1
        left = tokenize(previous.text)
        right = tokenize(current.text)
        if not left or not right:
            continue
        window = tokenize(
            _hypothesis_overlapping(previous, hyps) + " " + _hypothesis_overlapping(current, hyps)
        )
        if _contains(window, left[-1]) and _contains(window, right[0]):
            correct += 1

    return correct / boundaries if boundaries else 1.0


def script_fidelity(refs: Sequence[RefSegment], hyps: Sequence[HypSegment]) -> float:
    """Fraction of segments rendered in the script actually spoken."""
    checked = 0
    correct = 0
    for ref in refs:
        if ref.is_silence:
            continue
        expected = script_of(ref.text)
        if expected == "none":
            continue
        checked += 1
        if script_of(_hypothesis_overlapping(ref, hyps)) == expected:
            correct += 1
    return correct / checked if checked else 1.0


# --------------------------------------------------------------------------
# 4.3 Translation leak — a hard gate
# --------------------------------------------------------------------------


def translation_leak_rate(refs: Sequence[RefSegment], hyps: Sequence[HypSegment]) -> float:
    """Segments emitted in the other language instead of transcribed.

    Whisper-family models sometimes translate at a language switch. The output
    is fluent, plausible, and wrong about what was said — which is why this is a
    rejection gate rather than a score.
    """
    checked = 0
    leaked = 0
    for ref in refs:
        if ref.is_silence:
            continue
        expected = script_of(ref.text)
        if expected not in ("ar", "la"):
            continue
        got = script_of(_hypothesis_overlapping(ref, hyps))
        if got == "none":
            continue
        checked += 1
        if got in ("ar", "la") and got != expected:
            leaked += 1
    return leaked / checked if checked else 0.0


# --------------------------------------------------------------------------
# 4.4 Hallucination
# --------------------------------------------------------------------------


def insertion_rate(refs: Sequence[RefSegment], hyps: Sequence[HypSegment]) -> float:
    total = EditCounts()
    for ref in refs:
        if ref.is_silence:
            continue
        counts = word_error_rate(ref.text, _hypothesis_overlapping(ref, hyps))
        total.insertions += counts.insertions
        total.reference_length += counts.reference_length
    return total.insertions / total.reference_length if total.reference_length else 0.0


def silence_hallucination(refs: Sequence[RefSegment], hyps: Sequence[HypSegment]) -> int:
    """Tokens emitted during annotated silence. Should be zero."""
    return sum(
        len(tokenize(_hypothesis_overlapping(ref, hyps))) for ref in refs if ref.is_silence
    )


# --------------------------------------------------------------------------
# 4.5 Timestamps — citation anchors
# --------------------------------------------------------------------------


@dataclass
class TimestampScore:
    errors_ms: list[int] = field(default_factory=list)

    @property
    def median_error_ms(self) -> float:
        return statistics.median(self.errors_ms) if self.errors_ms else 0.0

    @property
    def p95_error_ms(self) -> float:
        if not self.errors_ms:
            return 0.0
        ordered = sorted(self.errors_ms)
        index = min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1))))
        return float(ordered[index])

    def within(self, tolerance_ms: int) -> float:
        if not self.errors_ms:
            return 1.0
        return sum(1 for e in self.errors_ms if e <= tolerance_ms) / len(self.errors_ms)


def timestamp_score(refs: Sequence[RefSegment], hyps: Sequence[HypSegment]) -> TimestampScore:
    """A citation that jumps to the wrong place is worse than no citation."""
    score = TimestampScore()
    for ref in refs:
        if ref.is_silence:
            continue
        nearest = _nearest_hypothesis(ref, hyps)
        if nearest is None:
            continue
        score.errors_ms.append(abs(nearest.start_ms - ref.start_ms))
    return score


# --------------------------------------------------------------------------
# 4.6 Throughput — decisive under the $0 budget
# --------------------------------------------------------------------------


def real_time_factor(processing_seconds: float, audio_seconds: float) -> float:
    """Processing time divided by audio duration.

    Below 1.0 the engine keeps ahead of a speaker; above it, live transcription
    is impossible however accurate the engine is. With no GPU and no ASR budget,
    this is the metric that decides whether Sanad has a live tier at all.
    """
    if audio_seconds <= 0:
        raise ValueError("audio_seconds must be positive")
    return processing_seconds / audio_seconds


def percentile(values: Iterable[float], fraction: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    index = min(len(ordered) - 1, int(round(fraction * (len(ordered) - 1))))
    return float(ordered[index])


# --------------------------------------------------------------------------
# 4.7 Confidence calibration
# --------------------------------------------------------------------------


def confidence_calibration(
    refs: Sequence[RefSegment], hyps: Sequence[HypSegment], buckets: int = 5
) -> list[dict[str, float]]:
    """WER per confidence bucket.

    An engine whose confidence does not predict error cannot support the
    low-confidence marking in AI_PIPELINE.md section 2 — the UI would be showing
    students a reliability signal that means nothing.
    """
    binned: list[list[tuple[EditCounts, float]]] = [[] for _ in range(buckets)]
    for ref in refs:
        if ref.is_silence:
            continue
        hyp = _nearest_hypothesis(ref, hyps)
        if hyp is None or hyp.confidence is None:
            continue
        index = min(buckets - 1, max(0, int(hyp.confidence * buckets)))
        binned[index].append((word_error_rate(ref.text, hyp.text), hyp.confidence))

    report: list[dict[str, float]] = []
    for i, entries in enumerate(binned):
        if not entries:
            continue
        total = EditCounts()
        for counts, _ in entries:
            total.substitutions += counts.substitutions
            total.deletions += counts.deletions
            total.insertions += counts.insertions
            total.reference_length += counts.reference_length
        report.append(
            {
                "bucket_low": i / buckets,
                "bucket_high": (i + 1) / buckets,
                "wer": round(total.error_rate, 4),
                "n": len(entries),
            }
        )
    return report


# --------------------------------------------------------------------------
# Alignment helpers
# --------------------------------------------------------------------------


def _overlap_ms(a_start: int, a_end: int, b_start: int, b_end: int) -> int:
    return max(0, min(a_end, b_end) - max(a_start, b_start))


def _hypothesis_overlapping(ref: RefSegment, hyps: Sequence[HypSegment]) -> str:
    """All hypothesis text overlapping a reference segment in time."""
    parts = [
        h.text
        for h in hyps
        if _overlap_ms(ref.start_ms, ref.end_ms, h.start_ms, h.end_ms) > 0
    ]
    return " ".join(parts)


def _nearest_hypothesis(ref: RefSegment, hyps: Sequence[HypSegment]) -> HypSegment | None:
    best: HypSegment | None = None
    best_overlap = 0
    for h in hyps:
        overlap = _overlap_ms(ref.start_ms, ref.end_ms, h.start_ms, h.end_ms)
        if overlap > best_overlap:
            best, best_overlap = h, overlap
    if best is None and hyps:
        best = min(hyps, key=lambda h: abs(h.start_ms - ref.start_ms))
    return best
