"""Text normalization, mirroring packages/core/src/text.ts.

Two implementations of one rule is exactly how index-time and query-time
normalization drift apart, which is a silent retrieval failure (AI_PIPELINE.md
section 8). Both are pinned to shared/text-normalization-vectors.json, and
test_normalization.py fails if they diverge.
"""

from __future__ import annotations

import re
import unicodedata

TASHKEEL = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭ]")
TATWEEL = re.compile("ـ")
ARABIC_INDIC = re.compile(r"[٠-٩۰-۹]")
NON_WORD = re.compile(r"[^\w\s]", re.UNICODE)
WHITESPACE = re.compile(r"\s+")

# Arabic script range, used for script-fidelity and translation-leak detection.
ARABIC_SCRIPT = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
LATIN_SCRIPT = re.compile(r"[A-Za-z]")


def _fold_digits(match: re.Match[str]) -> str:
    code = ord(match.group(0))
    base = 0x06F0 if code >= 0x06F0 else 0x0660
    return str(code - base)


def normalize_arabic(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    text = TASHKEEL.sub("", text)
    text = TATWEEL.sub("", text)
    text = re.sub(r"[أإآٱ]", "ا", text)  # hamza forms -> alef
    text = text.replace("ى", "ي")  # alef maqsura -> ya
    text = text.replace("ة", "ه")  # ta marbuta -> ha
    return ARABIC_INDIC.sub(_fold_digits, text)


def normalize_for_search(text: str) -> str:
    """Applied identically to indexed text and to queries."""
    text = normalize_arabic(text).lower()
    text = NON_WORD.sub(" ", text)
    return WHITESPACE.sub(" ", text).strip()


def tokenize(text: str) -> list[str]:
    normalized = normalize_for_search(text)
    return normalized.split() if normalized else []


def script_of(text: str) -> str:
    """Dominant script: 'ar', 'la', 'mixed', or 'none'."""
    arabic = len(ARABIC_SCRIPT.findall(text))
    latin = len(LATIN_SCRIPT.findall(text))
    if arabic == 0 and latin == 0:
        return "none"
    if arabic == 0:
        return "la"
    if latin == 0:
        return "ar"
    ratio = arabic / (arabic + latin)
    if ratio > 0.8:
        return "ar"
    if ratio < 0.2:
        return "la"
    return "mixed"
