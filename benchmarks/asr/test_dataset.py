import json
import pathlib
import tempfile
import unittest

import dataset


def manifest(**overrides):
    base = {
        "version": "test-1",
        "segments": [
            {
                "id": "a1",
                "discipline": "discipline_one",
                "audio": "a1.wav",
                "duration_ms": 60000,
                "reference": [
                    {"start_ms": 0, "end_ms": 3000, "text": "first line", "language": "en"},
                    {"start_ms": 3000, "end_ms": 6000, "text": "سطر ثاني", "language": "ar"},
                ],
            },
            {
                "id": "b1",
                "discipline": "discipline_two",
                "audio": "b1.wav",
                "duration_ms": 60000,
                "reference": [
                    {"start_ms": 0, "end_ms": 3000, "text": "another line", "language": "en"}
                ],
            },
        ],
    }
    base.update(overrides)
    return base


def write(data):
    directory = pathlib.Path(tempfile.mkdtemp())
    path = directory / "manifest.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


class Loading(unittest.TestCase):
    def test_loads_a_valid_manifest(self):
        loaded = dataset.load(write(manifest()))
        self.assertEqual(len(loaded.segments), 2)
        self.assertEqual(loaded.disciplines, {"discipline_one", "discipline_two"})
        self.assertEqual(loaded.total_duration_ms, 120000)

    def test_missing_file_is_an_error(self):
        with self.assertRaises(dataset.DatasetError):
            dataset.load("/nonexistent/manifest.json")

    def test_version_is_required(self):
        data = manifest()
        del data["version"]
        with self.assertRaisesRegex(dataset.DatasetError, "version"):
            dataset.load(write(data))


class Validation(unittest.TestCase):
    def test_rejects_a_single_discipline(self):
        """Two unrelated disciplines is the point of the dataset, not a nicety."""
        data = manifest()
        data["segments"][1]["discipline"] = "discipline_one"
        with self.assertRaisesRegex(dataset.DatasetError, "discipline"):
            dataset.load(write(data))

    def test_rejects_overlapping_reference_segments(self):
        data = manifest()
        data["segments"][0]["reference"][1]["start_ms"] = 1000
        with self.assertRaisesRegex(dataset.DatasetError, "overlap"):
            dataset.load(write(data))

    def test_rejects_an_unknown_language_tag(self):
        data = manifest()
        data["segments"][0]["reference"][0]["language"] = "fr"
        with self.assertRaisesRegex(dataset.DatasetError, "language"):
            dataset.load(write(data))

    def test_rejects_empty_non_silence_reference(self):
        data = manifest()
        data["segments"][0]["reference"][0]["text"] = "   "
        with self.assertRaisesRegex(dataset.DatasetError, "empty text"):
            dataset.load(write(data))

    def test_allows_empty_text_for_annotated_silence(self):
        data = manifest()
        data["segments"][0]["reference"][0] = {
            "start_ms": 0, "end_ms": 3000, "text": "", "language": "en", "silence": True,
        }
        self.assertEqual(len(dataset.load(write(data)).segments), 2)


class Summary(unittest.TestCase):
    def test_reports_size_and_coverage(self):
        text = dataset.summarize(dataset.load(write(manifest())))
        self.assertIn("2 segments", text)
        self.assertIn("2 disciplines", text)


if __name__ == "__main__":
    unittest.main()
