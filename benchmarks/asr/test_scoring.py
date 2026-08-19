"""Known-answer verification of the metrics (ASR_BENCHMARK.md section 6, step 2).

Every case here has a hand-computed expected value. A metric that quietly
flatters one candidate is worse than no benchmark at all, so the harness is
tested before it is trusted with a decision.
"""

import unittest

from scoring import (
    HypSegment,
    RefSegment,
    Term,
    code_switch_boundary_accuracy,
    confidence_calibration,
    insertion_rate,
    real_time_factor,
    script_fidelity,
    silence_hallucination,
    term_score,
    timestamp_score,
    translation_leak_rate,
    wer_by_language,
    word_error_rate,
)


def ref(start, end, text, language="en", terms=(), silence=False):
    return RefSegment(start, end, text, language, tuple(terms), silence)


def hyp(start, end, text, confidence=None):
    return HypSegment(start, end, text, confidence)


class WordErrorRate(unittest.TestCase):
    def test_identical_text_scores_zero(self):
        counts = word_error_rate("the counter increments on each clock edge",
                                 "the counter increments on each clock edge")
        self.assertEqual(counts.error_rate, 0.0)

    def test_counts_one_substitution(self):
        counts = word_error_rate("the counter increments", "the counter decrements")
        self.assertEqual((counts.substitutions, counts.deletions, counts.insertions), (1, 0, 0))
        self.assertAlmostEqual(counts.error_rate, 1 / 3)

    def test_counts_one_deletion(self):
        counts = word_error_rate("the counter increments", "the counter")
        self.assertEqual((counts.substitutions, counts.deletions, counts.insertions), (0, 1, 0))

    def test_counts_one_insertion(self):
        counts = word_error_rate("the counter", "the counter increments")
        self.assertEqual((counts.substitutions, counts.deletions, counts.insertions), (0, 0, 1))

    def test_empty_hypothesis_is_total_loss(self):
        counts = word_error_rate("three words here", "")
        self.assertEqual(counts.error_rate, 1.0)

    def test_normalization_applies_before_scoring(self):
        # Tashkeel and punctuation must not register as errors.
        self.assertEqual(word_error_rate("مُحَاضَرَة", "محاضره").error_rate, 0.0)

    def test_language_scoped_wer_ignores_other_regions(self):
        refs = [
            ref(0, 1000, "the clock signal", "en"),
            ref(1000, 2000, "الاشارة الرقمية", "ar"),
        ]
        hyps = [hyp(0, 1000, "the clock signal"), hyp(1000, 2000, "الاشارة التناظرية")]
        self.assertEqual(wer_by_language(refs, hyps, "en").error_rate, 0.0)
        self.assertAlmostEqual(wer_by_language(refs, hyps, "ar").error_rate, 0.5)


class TechnicalTerms(unittest.TestCase):
    """The primary metric. Terms are a small share of tokens, most of the meaning."""

    TERM = Term(canonical="widget-latch", aliases=("ودجت لاتش",))

    def test_recognized_term_scores_perfectly(self):
        refs = [ref(0, 1000, "the widget-latch stores one bit", terms=[self.TERM])]
        hyps = [hyp(0, 1000, "the widget-latch stores one bit")]
        score = term_score(refs, hyps)
        self.assertEqual((score.recall, score.precision, score.f1), (1.0, 1.0, 1.0))

    def test_alias_counts_as_recognized(self):
        # The reference records what was said; either script may be correct.
        refs = [ref(0, 1000, "the widget-latch stores one bit", terms=[self.TERM])]
        hyps = [hyp(0, 1000, "الـ ودجت لاتش stores one bit")]
        self.assertEqual(term_score(refs, hyps).recall, 1.0)

    def test_missed_term_drops_recall_to_zero(self):
        refs = [ref(0, 1000, "the widget-latch stores one bit", terms=[self.TERM])]
        hyps = [hyp(0, 1000, "the widget lunch stores one bit")]
        self.assertEqual(term_score(refs, hyps).recall, 0.0)

    def test_low_wer_can_hide_total_term_failure(self):
        """The case that justifies the whole metric design.

        Eight of nine tokens correct — a WER that looks respectable — while the
        one token that carries the meaning is wrong. Reporting only WER would
        call this transcript good; it is useless for retrieval.
        """
        refs = [ref(0, 1000, "so the widget-latch here stores exactly one bit", terms=[self.TERM])]
        hyps = [hyp(0, 1000, "so the widget lunch here stores exactly one bit")]
        counts = word_error_rate(refs[0].text, hyps[0].text)
        self.assertLess(counts.error_rate, 0.30)          # WER looks acceptable
        self.assertEqual(term_score(refs, hyps).recall, 0.0)  # the term is gone

    def test_high_wer_can_still_preserve_every_term(self):
        """The mirror case: a messy transcript that stays useful for retrieval."""
        refs = [ref(0, 1000, "so the widget-latch here stores exactly one bit", terms=[self.TERM])]
        hyps = [hyp(0, 1000, "um the widget-latch uh stores one bit")]
        self.assertGreater(word_error_rate(refs[0].text, hyps[0].text).error_rate, 0.25)
        self.assertEqual(term_score(refs, hyps).recall, 1.0)

    def test_spurious_term_reduces_precision(self):
        other = Term(canonical="phase-comparator")
        refs = [
            ref(0, 1000, "the widget-latch stores one bit", terms=[self.TERM]),
            ref(1000, 2000, "the phase-comparator locks", terms=[other]),
        ]
        # Second segment invents a term that was never said there.
        hyps = [
            hyp(0, 1000, "the widget-latch stores one bit"),
            hyp(1000, 2000, "the phase-comparator locks the widget-latch"),
        ]
        score = term_score(refs, hyps)
        self.assertEqual(score.recall, 1.0)
        self.assertLess(score.precision, 1.0)


class CodeSwitching(unittest.TestCase):
    def test_correct_boundary_scores_one(self):
        refs = [
            ref(0, 1000, "هذه الدائرة تستخدم", "ar"),
            ref(1000, 2000, "clock gating technique", "en"),
        ]
        hyps = [hyp(0, 1000, "هذه الدائرة تستخدم"), hyp(1000, 2000, "clock gating technique")]
        self.assertEqual(code_switch_boundary_accuracy(refs, hyps), 1.0)

    def test_lost_boundary_scores_zero(self):
        refs = [
            ref(0, 1000, "هذه الدائرة تستخدم", "ar"),
            ref(1000, 2000, "clock gating technique", "en"),
        ]
        hyps = [hyp(0, 1000, "هذه الدائرة"), hyp(1000, 2000, "gating technique")]
        self.assertEqual(code_switch_boundary_accuracy(refs, hyps), 0.0)

    def test_no_boundaries_is_not_a_failure(self):
        refs = [ref(0, 1000, "all english here", "en")]
        self.assertEqual(code_switch_boundary_accuracy(refs, [hyp(0, 1000, "all english here")]), 1.0)

    def test_script_fidelity_detects_wrong_script(self):
        refs = [ref(0, 1000, "الدائرة الرقمية", "ar")]
        self.assertEqual(script_fidelity(refs, [hyp(0, 1000, "الدائرة الرقمية")]), 1.0)
        self.assertEqual(script_fidelity(refs, [hyp(0, 1000, "the digital circuit")]), 0.0)


class TranslationLeak(unittest.TestCase):
    """A rejection gate, not a score: the output is fluent and wrong."""

    def test_faithful_transcription_has_no_leak(self):
        refs = [ref(0, 1000, "الدائرة الرقمية تعمل", "ar")]
        self.assertEqual(translation_leak_rate(refs, [hyp(0, 1000, "الدائرة الرقمية تعمل")]), 0.0)

    def test_translated_output_is_detected(self):
        refs = [ref(0, 1000, "الدائرة الرقمية تعمل", "ar")]
        self.assertEqual(translation_leak_rate(refs, [hyp(0, 1000, "the digital circuit works")]), 1.0)

    def test_partial_leak_is_a_fraction(self):
        refs = [
            ref(0, 1000, "الدائرة الرقمية", "ar"),
            ref(1000, 2000, "الاشارة المستمرة", "ar"),
        ]
        hyps = [hyp(0, 1000, "الدائرة الرقمية"), hyp(1000, 2000, "the continuous signal")]
        self.assertEqual(translation_leak_rate(refs, hyps), 0.5)


class Hallucination(unittest.TestCase):
    def test_clean_output_has_no_insertions(self):
        refs = [ref(0, 1000, "the clock edge")]
        self.assertEqual(insertion_rate(refs, [hyp(0, 1000, "the clock edge")]), 0.0)

    def test_invented_words_raise_the_insertion_rate(self):
        refs = [ref(0, 1000, "the clock edge")]
        self.assertAlmostEqual(insertion_rate(refs, [hyp(0, 1000, "the clock edge thank you")]), 2 / 3)

    def test_text_during_silence_is_counted(self):
        refs = [ref(0, 5000, "", silence=True)]
        self.assertEqual(silence_hallucination(refs, [hyp(0, 5000, "thanks for watching")]), 3)

    def test_silence_correctly_left_empty(self):
        refs = [ref(0, 5000, "", silence=True)]
        self.assertEqual(silence_hallucination(refs, [hyp(0, 5000, "")]), 0)


class Timestamps(unittest.TestCase):
    def test_exact_alignment_scores_zero_error(self):
        refs = [ref(0, 1000, "one"), ref(1000, 2000, "two")]
        hyps = [hyp(0, 1000, "one"), hyp(1000, 2000, "two")]
        score = timestamp_score(refs, hyps)
        self.assertEqual(score.median_error_ms, 0.0)
        self.assertEqual(score.within(500), 1.0)

    def test_drift_is_measured_and_bucketed(self):
        refs = [ref(0, 1000, "one"), ref(1000, 2000, "two")]
        hyps = [hyp(200, 1000, "one"), hyp(1000, 2000, "two")]
        score = timestamp_score(refs, hyps)
        self.assertEqual(sorted(score.errors_ms), [0, 200])
        self.assertEqual(score.within(500), 1.0)
        self.assertEqual(score.within(100), 0.5)


class Throughput(unittest.TestCase):
    """Decisive under the $0 budget: no GPU, so CPU speed decides the live tier."""

    def test_faster_than_realtime(self):
        self.assertAlmostEqual(real_time_factor(30.0, 60.0), 0.5)

    def test_slower_than_realtime_cannot_drive_live(self):
        self.assertGreater(real_time_factor(120.0, 60.0), 1.0)

    def test_rejects_nonsense_duration(self):
        with self.assertRaises(ValueError):
            real_time_factor(10.0, 0.0)


class ConfidenceCalibration(unittest.TestCase):
    def test_low_confidence_bucket_shows_higher_error(self):
        refs = [
            ref(0, 1000, "the clock signal rises"),
            ref(1000, 2000, "the counter resets now"),
        ]
        hyps = [
            hyp(0, 1000, "the clock signal rises", confidence=0.95),
            hyp(1000, 2000, "the counter beats no", confidence=0.15),
        ]
        report = confidence_calibration(refs, hyps)
        by_bucket = {r["bucket_low"]: r["wer"] for r in report}
        self.assertEqual(by_bucket[0.8], 0.0)
        self.assertGreater(by_bucket[0.0], 0.0)

    def test_segments_without_confidence_are_skipped(self):
        refs = [ref(0, 1000, "the clock signal")]
        self.assertEqual(confidence_calibration(refs, [hyp(0, 1000, "the clock signal")]), [])


if __name__ == "__main__":
    unittest.main()
