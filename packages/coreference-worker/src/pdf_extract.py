"""Native PDF text extract + per-page OCR flags for the hybrid Node strategy.

Does not call Azure. Pages with `needsOcr=true` are sent to Azure via pdf-lib in Node.

Rich per-page signals (headings/tables/pictures/boxes) are emitted for
downstream stages (persist to structuredData, heading-bounded chunking).
Consumers must ignore unknown keys: only pageIndex/text/needsOcr plus the
top-level extractor/pageCount are contractual.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


REPLACEMENT_RATIO = 0.08
MIN_TEXT_CHARS = 40


def _needs_ocr(text: str, image_count: int) -> bool:
    stripped = (text or "").strip()
    if not stripped:
        return image_count > 0
    repl = stripped.count("\ufffd") + stripped.count("�")
    if len(stripped) > 0 and repl / len(stripped) >= REPLACEMENT_RATIO:
        return True
    if len(stripped) < MIN_TEXT_CHARS and image_count > 0:
        return True
    return False


def _clean_heading_text(text: str) -> str:
    """Strip markdown/HTML wrappers so labels match plain resolved text."""
    cleaned = re.sub(r"<[^>]+>", "", text)
    cleaned = cleaned.replace("*", "").replace("_", "")
    return re.sub(r"\s+", " ", cleaned).strip()


def _parse_headings(markdown: str) -> list[dict[str, Any]]:
    """ATX headings from pymupdf4llm markdown: [{level, text}]."""
    headings: list[dict[str, Any]] = []
    for line in (markdown or "").splitlines():
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        hashes = stripped.split(" ", 1)[0]
        if not hashes or len(hashes) > 6 or any(c != "#" for c in hashes):
            continue
        text = _clean_heading_text(stripped[len(hashes):])
        if text:
            headings.append({"level": len(hashes), "text": text})
    return headings


def _table_to_markdown(rows: list[list[Any]]) -> str:
    def cell(value: Any) -> str:
        return str(value or "").replace("|", "\\|").strip()

    lines = ["| " + " | ".join(cell(v) for v in row) + " |" for row in rows]
    if len(lines) > 1:
        width = max(len(r) for r in rows)
        lines.insert(1, "| " + " | ".join("---" for _ in range(width)) + " |")
    return "\n".join(lines)


def _page_tables(page: Any) -> tuple[list[str], list[dict[str, Any]]]:
    """Bordered/vector tables via fitz find_tables. Returns (markdown, boxes)."""
    tables: list[str] = []
    boxes: list[dict[str, Any]] = []
    try:
        found = page.find_tables()
    except Exception:
        return tables, boxes
    for table in found:
        try:
            rows = table.extract()
        except Exception:
            continue
        if not rows:
            continue
        tables.append(_table_to_markdown(rows))
        try:
            x0, y0, x1, y1 = table.bbox
            boxes.append(
                {
                    "kind": "table",
                    "bbox": [x0, y0, x1, y1],
                }
            )
        except Exception:
            continue
    return tables, boxes


def _page_image_count(page: Any) -> int:
    try:
        return len(page.get_images() or [])
    except Exception:
        return 0


def _page_pictures(page: Any) -> list[dict[str, Any]]:
    """Embedded raster images with bboxes (exhibit/scan candidates)."""
    pictures: list[dict[str, Any]] = []
    try:
        images = page.get_images(full=True) or []
    except Exception:
        return pictures
    for img in images:
        try:
            rect = page.get_image_bbox(img)
        except Exception:
            continue
        try:
            if hasattr(rect, "x0"):
                bbox = [rect.x0, rect.y0, rect.x1, rect.y1]
            else:
                x0, y0, x1, y1 = rect
                bbox = [x0, y0, x1, y1]
        except Exception:
            continue
        pictures.append(
            {
                "bbox": bbox,
                "width": img[2] if len(img) > 2 else None,
                "height": img[3] if len(img) > 3 else None,
            }
        )
    return pictures


def _page_dict(page_index: int, text: str, needs_ocr: bool) -> dict[str, Any]:
    return {
        "pageIndex": page_index,
        "text": text,
        "needsOcr": needs_ocr,
        "markdown": "",
        "headings": [],
        "tables": [],
        "pictures": [],
        "boxes": [],
    }


def _extract_fitz(path: str) -> dict[str, Any]:
    import pymupdf  # type: ignore

    doc = pymupdf.open(path)
    pages: list[dict[str, Any]] = []
    for i, page in enumerate(doc):
        text = page.get_text("text") or ""
        image_count = _page_image_count(page)
        pictures = _page_pictures(page)
        tables, table_boxes = _page_tables(page)
        row = _page_dict(i, text, _needs_ocr(text, image_count))
        row["tables"] = tables
        row["pictures"] = pictures
        row["boxes"] = table_boxes + [
            {"kind": "picture", "bbox": p["bbox"]} for p in pictures
        ]
        pages.append(row)
    doc.close()
    return {"extractor": "pymupdf", "pageCount": len(pages), "pages": pages}


def _extract_4llm(path: str) -> dict[str, Any]:
    import pymupdf  # type: ignore
    import pymupdf4llm  # type: ignore

    doc = pymupdf.open(path)
    md_pages = pymupdf4llm.to_markdown(
        doc,
        page_chunks=True,
        use_ocr=False,
        header=False,
        footer=False,
    )
    pages: list[dict[str, Any]] = []
    for i, page in enumerate(doc):
        chunk = md_pages[i] if isinstance(md_pages, list) and i < len(md_pages) else {}
        md = ""
        if isinstance(chunk, dict):
            md = str(chunk.get("text") or "")
        raw = page.get_text("text") or ""
        image_count = _page_image_count(page)
        pictures = _page_pictures(page)
        tables, table_boxes = _page_tables(page)
        headings = _parse_headings(md)
        text = md.strip() or raw
        row = _page_dict(i, text, _needs_ocr(raw if not md.strip() else text, image_count))
        row["markdown"] = md
        row["headings"] = headings
        row["tables"] = tables
        row["pictures"] = pictures
        row["boxes"] = (
            [{"kind": "heading", "level": h["level"], "text": h["text"]} for h in headings]
            + table_boxes
            + [{"kind": "picture", "bbox": p["bbox"]} for p in pictures]
        )
        pages.append(row)
    doc.close()
    return {"extractor": "pymupdf4llm", "pageCount": len(pages), "pages": pages}


def extract(path: str) -> dict[str, Any]:
    try:
        return _extract_4llm(path)
    except ImportError:
        return _extract_fitz(path)


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: pdf_extract.py <file.pdf>", file=sys.stderr)
        sys.exit(2)
    path = sys.argv[1]
    if not Path(path).is_file():
        print(f"not a file: {path}", file=sys.stderr)
        sys.exit(2)
    json.dump(extract(path), sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
