from __future__ import annotations

import unittest
from unittest.mock import patch

from src.paralegal import chunk_text


def words(n: int, start: int = 0) -> str:
    return " ".join(f"w{i}" for i in range(start, start + n))


def paragraphs(*parts: str) -> str:
    return "\n\n".join(parts)


class ChunkTextParentIndexTest(unittest.TestCase):
    def setUp(self) -> None:
        self.token_patch = patch(
            "src.paralegal._token_count",
            side_effect=lambda text: len(text.split()) if text.strip() else 0,
        )
        self.token_patch.start()
        self.addCleanup(self.token_patch.stop)

    def test_leaf_omits_parent_chunk_index(self) -> None:
        chunks = chunk_text(words(4), max_tokens=10, parent_max_tokens=40)
        self.assertEqual(len(chunks), 1)
        self.assertNotIn("parentChunkIndex", chunks[0])
        self.assertEqual(chunks[0]["chunkIndex"], 0)

    def test_empty_text_omits_parent_chunk_index(self) -> None:
        chunks = chunk_text("   ", max_tokens=10, parent_max_tokens=40)
        self.assertEqual(len(chunks), 1)
        self.assertNotIn("parentChunkIndex", chunks[0])

    def test_split_section_emits_parent_then_children(self) -> None:
        # retrieval effective = 9; parent effective = 27.
        # Three 8-word paragraphs pack into one parent and split into 3 children.
        text = paragraphs(words(8, 0), words(8, 8), words(8, 16))
        chunks = chunk_text(text, max_tokens=10, parent_max_tokens=30)

        self.assertEqual(len(chunks), 4)
        parent, *children = chunks
        self.assertNotIn("parentChunkIndex", parent)
        self.assertEqual(parent["chunkIndex"], 0)
        self.assertEqual(parent["text"], text)
        self.assertEqual([c["chunkIndex"] for c in children], [1, 2, 3])
        self.assertTrue(all(c["parentChunkIndex"] == 0 for c in children))
        self.assertEqual("\n\n".join(c["text"] for c in children), text)

    def test_second_parent_window_gets_its_own_index(self) -> None:
        # Four 8-word paragraphs: parent window holds 3 (24 <= 27), leftover is a leaf.
        text = paragraphs(
            words(8, 0),
            words(8, 8),
            words(8, 16),
            words(8, 24),
        )
        chunks = chunk_text(text, max_tokens=10, parent_max_tokens=30)

        parents = [c for c in chunks if "parentChunkIndex" not in c]
        children = [c for c in chunks if "parentChunkIndex" in c]
        self.assertEqual(len(parents), 2)
        self.assertEqual(len(children), 3)
        self.assertEqual(parents[0]["chunkIndex"], 0)
        self.assertTrue(all(c["parentChunkIndex"] == 0 for c in children))
        self.assertEqual(parents[1]["chunkIndex"], 4)
        self.assertEqual(parents[1]["text"], words(8, 24))

    def test_position_weight_follows_parent_section(self) -> None:
        weights = {"default": {"chunk_0": 1.0, "chunk_1": 0.5}}
        text = paragraphs(
            words(8, 0),
            words(8, 8),
            words(8, 16),
            words(8, 24),
        )
        chunks = chunk_text(
            text,
            max_tokens=10,
            parent_max_tokens=30,
            weights=weights,
        )
        children = [c for c in chunks if "parentChunkIndex" in c]
        leaf = next(c for c in chunks if "parentChunkIndex" not in c and c["chunkIndex"] != 0)
        self.assertTrue(all(c["positionWeight"] == 1.0 for c in children))
        self.assertEqual(leaf["positionWeight"], 0.5)


if __name__ == "__main__":
    unittest.main()
