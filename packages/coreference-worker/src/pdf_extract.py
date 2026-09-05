"""Native PDF text extract + per-page OCR flags for the hybrid Node strategy.

Does not call Azure. Pages with `needsOcr=true` are sent to Azure via pdf-lib in Node.
"""

from __future__ import annotations

import json
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


def _extract_fitz(path: str) -> dict[str, Any]:
    import pymupdf  # type: ignore

    doc = pymupdf.open(path)
    pages: list[dict[str, Any]] = []
    for i, page in enumerate(doc):
        text = page.get_text("text") or ""
        image_count = len(page.get_images() or [])
        pages.append(
            {
                "pageIndex": i,
                "text": text,
                "needsOcr": _needs_ocr(text, image_count),
            }
        )
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
        image_count = len(page.get_images() or [])
        text = md.strip() or raw
        pages.append(
            {
                "pageIndex": i,
                "text": text,
                "needsOcr": _needs_ocr(raw if not md.strip() else text, image_count),
            }
        )
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
