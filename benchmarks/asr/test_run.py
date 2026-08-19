"""End-to-end harness test with synthetic engines.

Proves the scoring, gating and reporting path works before any real audio
exists, using a transcriber that is perfect and one that fails in each way the
gates are meant to catch.
"""

import json
import pathlib
import tempfile
import unittest

import dataset as dataset_module
import engines
import run


MANIFEST = {
    "version": "synthetic-1",
    "segments": [
        {
            "id": "s1",
            "discipline": "discipline_one",
            "audio": "s1.wav",
            "duration_ms": 10000,
            "reference": [
                {
                    "start_ms": 0, "end_ms": 5000, "language": "en",
                    "text": "the widget-latch stores exactly one bit",
                    "terms": [{"canonical": "widget-latch", "aliases": ["ودجت لاتش"]}],
                },
                {"start_ms": 5000, "end_ms": 10000, "language": "ar",
                 "text": "هذه الدائرة تعمل بشكل صحيح"},
            ],
        },
        {
            "id": "s2",
            "discipline": "discipline_two",
            "audio": "s2.wav",
            "duration_ms": 10000,
            "reference": [
                {
                    "start_ms": 0, "end_ms": 5000, "language": "en",
                    "text": "the phase-comparator locks the signal",
                    "terms": [{"canonical": "phase-comparator"}],
                },
                {"start_ms": 5000, "end_ms": 10000, "language": "ar",
                 "text": "نستخدم هذه الطريقة دائما"},
            ],
        },
    ],
}

PERFECT = {
    "s1.wav": [
        {"start_ms": 0, "end_ms": 5000, "text": "the widget-latch stores exactly one bit", "confidence": 0.95},
        {"start_ms": 5000, "end_ms": 10000, "text": "هذه الدائرة تعمل بشكل صحيح", "confidence": 0.93},
    ],
    "s2.wav": [
        {"start_ms": 0, "end_ms": 5000, "text": "the phase-comparator locks the signal", "confidence": 0.94},
        {"start_ms": 5000, "end_ms": 10000, "text": "نستخدم هذه الطريقة دائما", "confidence": 0.92},
    ],
}

TRANSLATING = {
    "s1.wav": [
        {"start_ms": 0, "end_ms": 5000, "text": "the widget-latch stores exactly one bit"},
        {"start_ms": 5000, "end_ms": 10000, "text": "this circuit works correctly"},
    ],
    "s2.wav": [
        {"start_ms": 0, "end_ms": 5000, "text": "the phase-comparator locks the signal"},
        {"start_ms": 5000, "end_ms": 10000, "text": "we always use this method"},
    ],
}

# Perfect on one discipline, term-blind on the other: the failure mode a
# single-subject benchmark could never detect.
LOPSIDED = {
    "s1.wav": PERFECT["s1.wav"],
    "s2.wav": [
        {"start_ms": 0, "end_ms": 5000, "text": "the face comparator locks the signal"},
        {"start_ms": 5000, "end_ms": 10000, "text": "نستخدم هذه الطريقة دائما"},
    ],
}


def load_manifest():
    directory = pathlib.Path(tempfile.mkdtemp())
    (directory / "manifest.json").write_text(json.dumps(MANIFEST), encoding="utf-8")
    return dataset_module.load(directory / "manifest.json")


def transcriber(table, delay_factor=0.0):
    def fn(audio_path):
        return table[pathlib.Path(audio_path).name]
    return fn


class HarnessEndToEnd(unittest.TestCase):
    def setUp(self):
        self.data = load_manifest()
        self.out = pathlib.Path(tempfile.mkdtemp())
        self.batch_engine = engines.find("faster-whisper-small")

    def test_perfect_transcript_passes_every_gate(self):
        report = run.run_with(self.data, self.batch_engine, transcriber(PERFECT), self.out)
        self.assertEqual(report["gate_failures"], [])
        self.assertEqual(report["summary"]["overall"]["term_f1"], 1.0)
        self.assertEqual(report["summary"]["integrity"]["translation_leak_rate"], 0.0)
        self.assertEqual(report["summary"]["cost"]["usd_per_audio_hour"], 0.0)

    def test_translating_engine_is_rejected(self):
        report = run.run_with(self.data, self.batch_engine, transcriber(TRANSLATING), self.out)
        failures = " ".join(report["gate_failures"])
        self.assertIn("REJECT", failures)
        self.assertIn("translation leak", failures)

    def test_uneven_disciplines_fail_the_generalization_gate(self):
        report = run.run_with(self.data, self.batch_engine, transcriber(LOPSIDED), self.out)
        gap = report["summary"]["term_f1_discipline_gap"]
        self.assertGreater(gap, run.THRESHOLDS["term_f1_gap_max"])
        self.assertTrue(any("does not generalize" in f for f in report["gate_failures"]))

    def test_writes_raw_hypotheses_for_reproducibility(self):
        run.run_with(self.data, self.batch_engine, transcriber(PERFECT), self.out)
        self.assertTrue((self.out / "s1.hypothesis.json").exists())
        self.assertTrue((self.out / "report.json").exists())
        report = json.loads((self.out / "report.json").read_text(encoding="utf-8"))
        self.assertIn("machine", report)  # an RTF without its hardware is not a number

    def test_live_tier_is_held_to_a_stricter_speed_gate(self):
        """Same transcript, different tier: only the live tier must beat RTF 0.7."""
        slow = run.aggregate([
            {
                "segment_id": "x", "discipline": "d1",
                "overall": {"wer": 0.1, "term_f1": 0.9},
                "terms": {"recall": 0.9, "precision": 0.9, "f1": 0.9, "reference_total": 1},
                "by_language": {"ar": 0.2, "en": 0.1},
                "code_switch": {"boundary_accuracy": 0.9, "script_fidelity": 1.0},
                "integrity": {"translation_leak_rate": 0.0, "insertion_rate": 0.0,
                              "silence_hallucination": 0},
                "timestamps": {"median_error_ms": 0, "p95_error_ms": 0, "within_500ms": 1.0},
                "throughput": {"processing_seconds": 20, "audio_seconds": 10,
                               "real_time_factor": 2.0},
                "confidence_calibration": [], "cost": {"usd_per_audio_hour": 0.0},
            }
        ])
        self.assertTrue(any("real-time factor" in f for f in run.evaluate_gates(slow, "live")))
        self.assertEqual(run.evaluate_gates(slow, "batch"), [])


class BudgetGate(unittest.TestCase):
    def test_a_paid_engine_cannot_be_selected(self):
        paid = engines.Engine("paid-example", "Paid API", "batch", paid=True)
        with self.assertRaisesRegex(ValueError, r"\$0"):
            engines.assert_free(paid)

    def test_every_declared_candidate_is_free(self):
        for engine in engines.CANDIDATES:
            engines.assert_free(engine)


if __name__ == "__main__":
    unittest.main()
