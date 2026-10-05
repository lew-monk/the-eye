from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.pdf_extract import _parse_headings, _table_to_markdown, extract


def _make_pdf() -> Path:
    import pymupdf  # type: ignore

    tmp = Path(tempfile.mkdtemp())
    pdf = tmp / "fixture.pdf"
    doc = pymupdf.open()
    # Page 0: digital text with a big heading + body.
    page = doc.new_page()
    page.insert_text((72, 100), "ISSUES FOR DETERMINATION", fontsize=20)
    page.insert_text((72, 140), "The court considers the pleadings and the evidence.")
    # Ruled table grid (vector lines) with text cells.
    for r in range(4):
        for c in range(3):
            x0, y0 = 72 + c * 120, 220 + r * 30
            page.draw_rect(pymupdf.Rect(x0, y0, x0 + 120, y0 + 30))
            page.insert_text((x0 + 6, y0 + 20), f"R{r}C{c}", fontsize=10)
    # Page 1: blank (no text, no images) -> not OCR-worthy.
    doc.new_page()
    # Page 2: image-only -> needs OCR.
    img_page = doc.new_page()
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 100, 100), 0)
    pix.set_rect(pix.irect, (200, 30, 90))
    img_page.insert_image(img_page.rect, pixmap=pix)
    doc.save(str(pdf))
    doc.close()
    return pdf


class ParseHeadingsTest(unittest.TestCase):
    def test_atx_levels_and_text(self) -> None:
        md = "# Holding\n\nbody\n\n### Orders\n\n####### nope\n\n#\n"
        self.assertEqual(
            _parse_headings(md),
            [
                {"level": 1, "text": "Holding"},
                {"level": 3, "text": "Orders"},
            ],
        )

    def test_strips_markdown_and_html_wrappers(self) -> None:
        md = "# **<u>Background</u>**\n\n## **Mediation**\n"
        self.assertEqual(
            _parse_headings(md),
            [
                {"level": 1, "text": "Background"},
                {"level": 2, "text": "Mediation"},
            ],
        )

    def test_empty(self) -> None:
        self.assertEqual(_parse_headings(""), [])
        self.assertEqual(_parse_headings("no headings here"), [])


class TableToMarkdownTest(unittest.TestCase):
    def test_pipe_table_with_separator(self) -> None:
        md = _table_to_markdown([["a", "b"], ["c", "d|e"]])
        lines = md.splitlines()
        self.assertEqual(lines[0], "| a | b |")
        self.assertEqual(lines[1], "| --- | --- |")
        self.assertEqual(lines[2], "| c | d\\|e |")


class RichExtractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pdf = _make_pdf()
        cls.result = extract(str(cls.pdf))

    def test_contract_keys(self) -> None:
        self.assertEqual(self.result["pageCount"], 3)
        for page in self.result["pages"]:
            for key in ("pageIndex", "text", "needsOcr"):
                self.assertIn(key, page)

    def test_rich_keys_defaulted(self) -> None:
        for page in self.result["pages"]:
            for key in ("markdown", "headings", "tables", "pictures", "boxes"):
                self.assertIn(key, page)

    def test_blank_page_not_ocr(self) -> None:
        blank = self.result["pages"][1]
        self.assertFalse(blank["needsOcr"])
        self.assertEqual(blank["tables"], [])
        self.assertEqual(blank["pictures"], [])

    def test_image_only_page_needs_ocr_with_picture_box(self) -> None:
        img = self.result["pages"][2]
        self.assertTrue(img["needsOcr"])
        self.assertEqual(len(img["pictures"]), 1)
        bbox = img["pictures"][0]["bbox"]
        self.assertEqual(len(bbox), 4)
        kinds = [b["kind"] for b in img["boxes"]]
        self.assertIn("picture", kinds)

    def test_table_detected_as_single_markdown_block(self) -> None:
        first = self.result["pages"][0]
        self.assertGreaterEqual(len(first["tables"]), 1)
        self.assertIn("|", first["tables"][0])
        kinds = [b["kind"] for b in first["boxes"]]
        self.assertIn("table", kinds)


if __name__ == "__main__":
    unittest.main()
