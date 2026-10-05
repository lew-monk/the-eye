from __future__ import annotations

import unittest
from unittest.mock import patch

from src.paralegal import _normalize_section, _split_sections, chunk_text


def words(n: int, start: int = 0) -> str:
    return " ".join(f"w{i}" for i in range(start, start + n))


class SplitSectionsTest(unittest.TestCase):
    def test_splits_in_order_with_preamble(self) -> None:
        text = "intro\n\nHOLDING\nbody one\n\nORDERS\nbody two\n"
        sections = _split_sections(text, ["holding", "orders"])
        self.assertEqual([s for s, _ in sections], ["", "holding", "orders"])
        self.assertIn("intro", sections[0][1])
        self.assertIn("body two", sections[2][1])

    def test_markdown_prefix_tolerated(self) -> None:
        text = "# Holding\nbody\n"
        sections = _split_sections(text, ["Holding"])
        self.assertEqual(len(sections), 1)
        self.assertEqual(sections[0][0], "Holding")

    def test_unmatched_headings_ignored(self) -> None:
        text = "just prose\n"
        self.assertEqual(_split_sections(text, ["Nope"]), [("", text)])

    def test_no_headings_single_section(self) -> None:
        text = "just prose\n"
        self.assertEqual(_split_sections(text, None), [("", text)])
        self.assertEqual(_split_sections(text, []), [("", text)])

    def test_normalize_section(self) -> None:
        self.assertEqual(_normalize_section("Issues for Determination!"), "issues_for_determination")


class SectionChunkTest(unittest.TestCase):
    def setUp(self) -> None:
        self.token_patch = patch(
            "src.paralegal._token_count",
            side_effect=lambda text: len(text.split()) if text.strip() else 0,
        )
        self.token_patch.start()
        self.addCleanup(self.token_patch.stop)

    def test_section_labels_and_uid(self) -> None:
        text = "pre\n\nHOLDING\nhold body\n\nORDERS\norder body\n"
        chunks = chunk_text(
            text, max_tokens=40, section_headings=["holding", "orders"],
            document_id=7, chunker_version=1,
        )
        by_section: dict[str, list] = {}
        for c in chunks:
            by_section.setdefault(c["section"], []).append(c)
        self.assertEqual(sorted(by_section), ["", "holding", "orders"])
        uids = [c["chunkUid"] for c in chunks]
        self.assertTrue(all(uids))
        self.assertEqual(len(set(uids)), len(uids))
        # Deterministic across runs.
        again = chunk_text(
            text, max_tokens=40, section_headings=["holding", "orders"],
            document_id=7, chunker_version=1,
        )
        self.assertEqual([c["chunkUid"] for c in again], uids)

    def test_no_overlap_across_sections(self) -> None:
        text = "HOLDING\n" + words(60) + "\n\nORDERS\n" + words(60, 100) + "\n"
        chunks = chunk_text(
            text, max_tokens=20, section_headings=["holding", "orders"], document_id=3,
        )
        orders = [c for c in chunks if c["section"] == "orders"]
        self.assertTrue(orders)
        for c in orders:
            self.assertNotIn("w0", c["text"].split())

    def test_table_atomic_single_chunk(self) -> None:
        table = "| a | b |\n| --- | --- |\n| c | d |\n"
        text = "HOLDING\n" + words(100) + "\n\n" + table + "\n\nmore prose here\n"
        chunks = chunk_text(
            text, max_tokens=20, section_headings=["holding"], document_id=3,
        )
        table_chunks = [c for c in chunks if "| a | b |" in c["text"]]
        self.assertEqual(len(table_chunks), 1)
        self.assertNotIn("parentChunkIndex", table_chunks[0])

    def test_section_weight_key(self) -> None:
        weights = {"default": {"section_holding": 0.99}}
        text = "HOLDING\n" + words(10) + "\n"
        chunks = chunk_text(
            text, max_tokens=40, weights=weights,
            section_headings=["holding"], document_id=3,
        )
        holding = [c for c in chunks if c["section"] == "holding"]
        self.assertTrue(holding)
        self.assertTrue(all(c["positionWeight"] == 0.99 for c in holding))

    def test_legacy_path_unchanged_without_headings(self) -> None:
        text = words(24)
        chunks = chunk_text(text, max_tokens=10)
        self.assertTrue(all("section" not in c for c in chunks))
        self.assertTrue(all("chunkUid" not in c for c in chunks))


if __name__ == "__main__":
    unittest.main()
