import json
import pathlib
import unittest

from normalization import normalize_for_search, script_of, tokenize

VECTORS = json.loads(
    (pathlib.Path(__file__).parents[2] / "shared" / "text-normalization-vectors.json")
    .read_text(encoding="utf-8")
)


class SharedVectors(unittest.TestCase):
    """The same fixtures the TypeScript implementation is held to."""

    def test_matches_shared_vectors(self) -> None:
        for case in VECTORS["search"]:
            with self.subTest(case["in"]):
                self.assertEqual(normalize_for_search(case["in"]), case["out"], case["why"])

    def test_is_idempotent(self) -> None:
        for case in VECTORS["search"]:
            once = normalize_for_search(case["in"])
            self.assertEqual(normalize_for_search(once), once)


class Tokenizing(unittest.TestCase):
    def test_empty_input_yields_no_tokens(self) -> None:
        self.assertEqual(tokenize(""), [])
        self.assertEqual(tokenize("   "), [])

    def test_splits_on_normalized_whitespace(self) -> None:
        self.assertEqual(tokenize("Lecture  04 — Notes!"), ["lecture", "04", "notes"])


class ScriptDetection(unittest.TestCase):
    def test_detects_dominant_script(self) -> None:
        self.assertEqual(script_of("محاضرة اليوم"), "ar")
        self.assertEqual(script_of("today's lecture"), "la")
        self.assertEqual(script_of("الـ flip-flop بيخزن bit"), "mixed")
        self.assertEqual(script_of("42 ..."), "none")


if __name__ == "__main__":
    unittest.main()
