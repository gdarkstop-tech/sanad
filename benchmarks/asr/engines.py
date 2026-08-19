"""Candidate ASR engines (ASR_BENCHMARK.md section 5).

Budget: $0 recurring. No paid engine may be a required dependency, so every
candidate here is open-source and runs on CPU. A free-tier hosted service may
be added for reference, but must declare `required=False` and can never be the
selected configuration.

Engines are declared, not imported at module load: the harness must be
installable and testable on a machine where none of them are present, and must
say plainly which are missing rather than failing obscurely.
"""

from __future__ import annotations

import importlib.util
import shutil
from dataclasses import dataclass
from typing import Callable, Literal

Tier = Literal["live", "batch", "client"]


@dataclass(frozen=True)
class Engine:
    key: str
    label: str
    tier: Tier
    """'live' candidates must beat the real-time-factor gate; 'batch' need not."""
    module: str | None = None
    """Python module that must be importable."""
    binary: str | None = None
    """Executable that must be on PATH."""
    paid: bool = False
    notes: str = ""

    def availability(self) -> tuple[bool, str]:
        if self.module and importlib.util.find_spec(self.module) is None:
            return False, f"python module '{self.module}' not installed"
        if self.binary and shutil.which(self.binary) is None:
            return False, f"binary '{self.binary}' not on PATH"
        return True, "ready"


# Ordered roughly fastest to most accurate. The live tier exists only because
# the $0 + no-GPU constraint may put real-time transcription out of reach with
# the accurate models; see ASR_BENCHMARK.md section 5.
CANDIDATES: tuple[Engine, ...] = (
    Engine("whispercpp-tiny", "whisper.cpp tiny (q5)", "live", binary="whisper-cli",
           notes="Fastest CPU path; accuracy floor"),
    Engine("whispercpp-base", "whisper.cpp base (q5)", "live", binary="whisper-cli"),
    Engine("whispercpp-small", "whisper.cpp small (q5)", "live", binary="whisper-cli",
           notes="Most likely live candidate that is still usable"),
    Engine("whispercpp-large-turbo", "whisper.cpp large-v3-turbo (q5)", "batch", binary="whisper-cli",
           notes="Accuracy ceiling for CPU batch"),
    Engine("faster-whisper-small", "faster-whisper small (int8)", "batch", module="faster_whisper"),
    Engine("faster-whisper-medium", "faster-whisper medium (int8)", "batch", module="faster_whisper"),
    Engine("faster-whisper-large-turbo", "faster-whisper large-v3-turbo (int8)", "batch",
           module="faster_whisper", notes="Usually best CPU accuracy-per-second"),
    Engine("vosk-ar", "Vosk Arabic", "live", module="vosk",
           notes="Built for streaming; expected weaker on technical terms — measure how much"),
    Engine("vosk-en", "Vosk English", "live", module="vosk"),
    Engine("transformers-js-base", "Transformers.js whisper-base (WASM, in-browser)", "client",
           notes="Zero server cost entirely; bounded by the student's device"),
)


def find(key: str) -> Engine:
    for engine in CANDIDATES:
        if engine.key == key:
            return engine
    raise KeyError(f"Unknown engine '{key}'. Known: {', '.join(e.key for e in CANDIDATES)}")


def available() -> list[Engine]:
    return [engine for engine in CANDIDATES if engine.availability()[0]]


def assert_free(engine: Engine) -> None:
    """The budget gate. A paid engine may be measured for reference but can
    never be the selected configuration (ASR_BENCHMARK.md section 7)."""
    if engine.paid:
        raise ValueError(
            f"Engine '{engine.key}' has a recurring cost and cannot be a required dependency. "
            "The MVP budget for ASR is $0."
        )


Transcriber = Callable[[str], list[dict]]
"""An adapter: audio path -> [{start_ms, end_ms, text, confidence?}].

Adapters are supplied by the caller so the harness has no hard dependency on
any engine. In the product these live behind SpeechToTextProvider
(AI_PIPELINE.md section 1); the benchmark drives the same interface so it
measures the real code path.
"""
