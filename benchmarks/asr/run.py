#!/usr/bin/env python3
"""Benchmark runner (ASR_BENCHMARK.md section 6).

    python3 run.py --check                       # what is installed, what is not
    python3 run.py --self-test                   # verify the metrics first
    python3 run.py --dataset dataset/manifest.json --engine faster-whisper-small

Scoring is shared across candidates with no per-engine special handling, and
raw hypotheses are written alongside the scores so any number can be re-derived.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import platform
import subprocess
import sys
import time
from typing import Sequence

import dataset as dataset_module
import engines
import scoring
from scoring import HypSegment


def machine_description() -> dict[str, object]:
    """An RTF without its hardware is not a number."""
    return {
        "platform": platform.platform(),
        "processor": platform.processor() or platform.machine(),
        "python": platform.python_version(),
        "cpu_count": __import__("os").cpu_count(),
    }


def score_segment(
    segment: dataset_module.Segment, hypotheses: Sequence[HypSegment], elapsed_s: float
) -> dict:
    refs = segment.references
    terms = scoring.term_score(refs, hypotheses)
    timestamps = scoring.timestamp_score(refs, hypotheses)
    overall = scoring.EditCounts()
    for ref in refs:
        if ref.is_silence:
            continue
        counts = scoring.word_error_rate(ref.text, scoring._hypothesis_overlapping(ref, hypotheses))
        overall.substitutions += counts.substitutions
        overall.deletions += counts.deletions
        overall.insertions += counts.insertions
        overall.reference_length += counts.reference_length

    return {
        "segment_id": segment.segment_id,
        "discipline": segment.discipline,
        "overall": {"wer": round(overall.error_rate, 4), "term_f1": round(terms.f1, 4)},
        "terms": {
            "recall": round(terms.recall, 4),
            "precision": round(terms.precision, 4),
            "f1": round(terms.f1, 4),
            "reference_total": terms.reference_total,
        },
        "by_language": {
            language: round(scoring.wer_by_language(refs, hypotheses, language).error_rate, 4)
            for language in ("ar", "en")
        },
        "code_switch": {
            "boundary_accuracy": round(scoring.code_switch_boundary_accuracy(refs, hypotheses), 4),
            "script_fidelity": round(scoring.script_fidelity(refs, hypotheses), 4),
        },
        "integrity": {
            "translation_leak_rate": round(scoring.translation_leak_rate(refs, hypotheses), 4),
            "insertion_rate": round(scoring.insertion_rate(refs, hypotheses), 4),
            "silence_hallucination": scoring.silence_hallucination(refs, hypotheses),
        },
        "timestamps": {
            "median_error_ms": timestamps.median_error_ms,
            "p95_error_ms": timestamps.p95_error_ms,
            "within_500ms": round(timestamps.within(500), 4),
        },
        "throughput": {
            "processing_seconds": round(elapsed_s, 3),
            "audio_seconds": segment.duration_ms / 1000,
            "real_time_factor": round(
                scoring.real_time_factor(elapsed_s, segment.duration_ms / 1000), 4
            ),
        },
        "confidence_calibration": scoring.confidence_calibration(refs, hypotheses),
        "cost": {"usd_per_audio_hour": 0.0},
    }


def aggregate(segment_reports: list[dict]) -> dict:
    def mean(path: Sequence[str]) -> float:
        values = []
        for report in segment_reports:
            node: object = report
            for key in path:
                node = node[key]  # type: ignore[index]
            values.append(float(node))  # type: ignore[arg-type]
        return round(sum(values) / len(values), 4) if values else 0.0

    by_discipline: dict[str, list[float]] = {}
    for report in segment_reports:
        by_discipline.setdefault(report["discipline"], []).append(report["terms"]["f1"])
    discipline_f1 = {
        name: round(sum(values) / len(values), 4) for name, values in by_discipline.items()
    }
    gap = round(max(discipline_f1.values()) - min(discipline_f1.values()), 4) if discipline_f1 else 0.0

    return {
        "overall": {"wer": mean(["overall", "wer"]), "term_f1": mean(["terms", "f1"])},
        "by_discipline": discipline_f1,
        "term_f1_discipline_gap": gap,
        "by_language": {
            "ar": mean(["by_language", "ar"]),
            "en": mean(["by_language", "en"]),
        },
        "code_switch": {
            "boundary_accuracy": mean(["code_switch", "boundary_accuracy"]),
            "script_fidelity": mean(["code_switch", "script_fidelity"]),
        },
        "integrity": {
            "translation_leak_rate": mean(["integrity", "translation_leak_rate"]),
            "insertion_rate": mean(["integrity", "insertion_rate"]),
            "silence_hallucination": sum(
                r["integrity"]["silence_hallucination"] for r in segment_reports
            ),
        },
        "timestamps": {"within_500ms": mean(["timestamps", "within_500ms"])},
        "throughput": {"real_time_factor": mean(["throughput", "real_time_factor"])},
        "cost": {"usd_per_audio_hour": 0.0},
    }


THRESHOLDS = {
    "term_f1_min": 0.75,
    "term_f1_gap_max": 0.15,
    "wer_ar_max": 0.35,
    "wer_en_max": 0.25,
    "code_switch_min": 0.70,
    "translation_leak_max": 0.01,
    "rtf_live_max": 0.7,
    "rtf_batch_max": 3.0,
}


def evaluate_gates(summary: dict, tier: str) -> list[str]:
    """Thresholds are fixed in advance so a result cannot be reinterpreted to
    fit a preferred conclusion (ASR_BENCHMARK.md section 9)."""
    failures = []
    if summary["overall"]["term_f1"] < THRESHOLDS["term_f1_min"]:
        failures.append(f"term F1 {summary['overall']['term_f1']} < {THRESHOLDS['term_f1_min']}")
    if summary["term_f1_discipline_gap"] > THRESHOLDS["term_f1_gap_max"]:
        failures.append(
            f"term F1 gap between disciplines {summary['term_f1_discipline_gap']} "
            f"> {THRESHOLDS['term_f1_gap_max']} — the result does not generalize"
        )
    if summary["by_language"]["ar"] > THRESHOLDS["wer_ar_max"]:
        failures.append(f"Arabic WER {summary['by_language']['ar']} > {THRESHOLDS['wer_ar_max']}")
    if summary["by_language"]["en"] > THRESHOLDS["wer_en_max"]:
        failures.append(f"English WER {summary['by_language']['en']} > {THRESHOLDS['wer_en_max']}")
    if summary["code_switch"]["boundary_accuracy"] < THRESHOLDS["code_switch_min"]:
        failures.append(
            f"code-switch boundary accuracy {summary['code_switch']['boundary_accuracy']} "
            f"< {THRESHOLDS['code_switch_min']}"
        )
    if summary["integrity"]["translation_leak_rate"] > THRESHOLDS["translation_leak_max"]:
        failures.append(
            f"REJECT: translation leak {summary['integrity']['translation_leak_rate']} "
            f"> {THRESHOLDS['translation_leak_max']} — fluent output that is wrong about what was said"
        )
    limit = THRESHOLDS["rtf_live_max"] if tier == "live" else THRESHOLDS["rtf_batch_max"]
    if summary["throughput"]["real_time_factor"] > limit:
        failures.append(
            f"real-time factor {summary['throughput']['real_time_factor']} > {limit} for the '{tier}' tier"
        )
    return failures


def cmd_check(_args: argparse.Namespace) -> int:
    print(f"machine: {json.dumps(machine_description())}\n")
    print(f"{'engine':<32} {'tier':<8} status")
    print("-" * 72)
    for engine in engines.CANDIDATES:
        ok, reason = engine.availability()
        print(f"{engine.key:<32} {engine.tier:<8} {'READY' if ok else 'missing — ' + reason}")
    ready = len(engines.available())
    print(f"\n{ready}/{len(engines.CANDIDATES)} engines installed.")
    if ready == 0:
        print("Install at least one candidate before running the benchmark; see README.md.")
    return 0


def cmd_self_test(_args: argparse.Namespace) -> int:
    """Step 2 of the protocol: verify the harness before trusting it."""
    result = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", str(pathlib.Path(__file__).parent),
         "-p", "test_*.py"],
        capture_output=True,
        text=True,
    )
    print(result.stderr or result.stdout)
    return result.returncode


def cmd_run(args: argparse.Namespace) -> int:
    data = dataset_module.load(args.dataset)
    print(dataset_module.summarize(data))

    engine = engines.find(args.engine)
    engines.assert_free(engine)
    ok, reason = engine.availability()
    if not ok:
        print(f"\nCannot run '{engine.key}': {reason}", file=sys.stderr)
        print("Run `python3 run.py --check` to see what is installed.", file=sys.stderr)
        return 2

    print(
        f"\nNo adapter is wired for '{engine.key}' yet.\n"
        "Supply one as engines.Transcriber and pass it to run_with(); the scoring,\n"
        "gating and reporting below are complete and tested.",
        file=sys.stderr,
    )
    return 3


def run_with(
    data: dataset_module.Dataset,
    engine: engines.Engine,
    transcribe: engines.Transcriber,
    out_dir: pathlib.Path,
) -> dict:
    """Score one engine over a dataset. Used by adapters and by tests."""
    engines.assert_free(engine)
    out_dir.mkdir(parents=True, exist_ok=True)
    segment_reports = []

    for segment in data.segments:
        started = time.perf_counter()
        raw = transcribe(str(segment.audio_path))
        elapsed = time.perf_counter() - started
        hypotheses = [
            HypSegment(
                start_ms=int(item["start_ms"]),
                end_ms=int(item["end_ms"]),
                text=item.get("text", ""),
                confidence=item.get("confidence"),
            )
            for item in raw
        ]
        # Raw hypotheses are kept so any published number can be re-derived.
        (out_dir / f"{segment.segment_id}.hypothesis.json").write_text(
            json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        segment_reports.append(score_segment(segment, hypotheses, elapsed))

    summary = aggregate(segment_reports)
    report = {
        "engine": engine.key,
        "tier": engine.tier,
        "dataset_version": data.version,
        "machine": machine_description(),
        "summary": summary,
        "segments": segment_reports,
        "gate_failures": evaluate_gates(summary, engine.tier),
    }
    (out_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sanad ASR benchmark")
    parser.add_argument("--check", action="store_true", help="list engines and availability")
    parser.add_argument("--self-test", action="store_true", help="verify the metrics")
    parser.add_argument("--dataset", help="path to dataset manifest")
    parser.add_argument("--engine", help="engine key (see --check)")
    parser.add_argument("--out", default="results", help="output directory")
    args = parser.parse_args(argv)

    if args.check:
        return cmd_check(args)
    if args.self_test:
        return cmd_self_test(args)
    if args.dataset and args.engine:
        return cmd_run(args)
    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
