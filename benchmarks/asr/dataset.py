"""Dataset loading and validation for the ASR benchmark.

The manifest is subject-independent: disciplines, terms, and aliases are all
data. Adding a third discipline is adding a file, never a code change
(ASR_BENCHMARK.md section 9).
"""

from __future__ import annotations

import json
import pathlib
from dataclasses import dataclass
from typing import Any

from scoring import RefSegment, Term

VALID_LANGUAGES = {"ar", "en", "mixed"}


class DatasetError(ValueError):
    """Raised for a manifest that cannot be scored. Never warn and continue:
    a silently malformed reference produces confident, wrong numbers."""


@dataclass(frozen=True)
class Segment:
    """One audio segment plus its human reference transcript."""

    segment_id: str
    discipline: str
    audio_path: pathlib.Path
    duration_ms: int
    references: tuple[RefSegment, ...]
    notes: str = ""


@dataclass(frozen=True)
class Dataset:
    version: str
    root: pathlib.Path
    segments: tuple[Segment, ...]

    @property
    def disciplines(self) -> set[str]:
        return {s.discipline for s in self.segments}

    @property
    def total_duration_ms(self) -> int:
        return sum(s.duration_ms for s in self.segments)


def load(manifest_path: str | pathlib.Path) -> Dataset:
    path = pathlib.Path(manifest_path)
    if not path.exists():
        raise DatasetError(f"No manifest at {path}")

    raw: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    root = path.parent

    version = raw.get("version")
    if not version:
        raise DatasetError("Manifest is missing 'version'; results must name the dataset they used.")

    segments = tuple(_parse_segment(entry, root) for entry in raw.get("segments", []))
    if not segments:
        raise DatasetError("Manifest contains no segments.")

    dataset = Dataset(version=version, root=root, segments=segments)
    _validate(dataset)
    return dataset


def _parse_segment(entry: dict[str, Any], root: pathlib.Path) -> Segment:
    try:
        segment_id = entry["id"]
        discipline = entry["discipline"]
        audio = root / entry["audio"]
        duration_ms = int(entry["duration_ms"])
    except KeyError as missing:
        raise DatasetError(f"Segment is missing required field {missing}") from missing

    references = []
    for item in entry.get("reference", []):
        language = item.get("language", "en")
        if language not in VALID_LANGUAGES:
            raise DatasetError(
                f"Segment {segment_id}: language '{language}' is not one of {sorted(VALID_LANGUAGES)}"
            )
        terms = tuple(
            Term(canonical=t["canonical"], aliases=tuple(t.get("aliases", [])))
            for t in item.get("terms", [])
        )
        references.append(
            RefSegment(
                start_ms=int(item["start_ms"]),
                end_ms=int(item["end_ms"]),
                text=item.get("text", ""),
                language=language,
                terms=terms,
                is_silence=bool(item.get("silence", False)),
            )
        )

    return Segment(
        segment_id=segment_id,
        discipline=discipline,
        audio_path=audio,
        duration_ms=duration_ms,
        references=tuple(references),
        notes=entry.get("notes", ""),
    )


def _validate(dataset: Dataset) -> None:
    problems: list[str] = []

    for segment in dataset.segments:
        if not segment.references:
            problems.append(f"{segment.segment_id}: no reference transcript")
        previous_end = -1
        for reference in segment.references:
            if reference.end_ms < reference.start_ms:
                problems.append(f"{segment.segment_id}: reference ends before it starts")
            if reference.start_ms < previous_end:
                problems.append(f"{segment.segment_id}: reference segments overlap or are unsorted")
            previous_end = reference.end_ms
            if not reference.is_silence and not reference.text.strip():
                problems.append(f"{segment.segment_id}: non-silence reference has empty text")

    # Two unrelated disciplines is a hard requirement, not a preference: a
    # benchmark on one subject measures how well an engine knows that subject,
    # and cannot detect a result that collapses on another (section 3).
    if len(dataset.disciplines) < 2:
        problems.append(
            f"Dataset covers {len(dataset.disciplines)} discipline(s); at least 2 unrelated ones are required."
        )

    if problems:
        raise DatasetError("Dataset validation failed:\n  - " + "\n  - ".join(problems))


def summarize(dataset: Dataset) -> str:
    minutes = dataset.total_duration_ms / 60_000
    terms = sum(len(r.terms) for s in dataset.segments for r in s.references)
    return (
        f"dataset {dataset.version}: {len(dataset.segments)} segments, "
        f"{minutes:.1f} min, {len(dataset.disciplines)} disciplines "
        f"({', '.join(sorted(dataset.disciplines))}), {terms} annotated terms"
    )
