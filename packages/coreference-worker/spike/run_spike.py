"""20-PDF spike: current hybrid extract (pdf_extract.py) vs Azure-only baseline.

Phase 1 (this script, zero Azure spend): for each sampled PDF run the native
extract and report coverage / OCR-page ratio / headings / timing, plus the
estimated Azure Document Intelligence cost under both strategies.

Usage (from repo root):
  packages/coreference-worker/.venv/bin/python \
    packages/coreference-worker/spike/run_spike.py --out .scratch/pdf-pipeline-remainder/spike

Outputs `<out>/results.json` (per-doc metrics + sample manifest) and prints a
markdown table to stdout for the report.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from pdf_extract import extract  # noqa: E402

# Azure AI Document Intelligence `prebuilt-read` (S0, West US, list at time of
# writing): ~$1.50 / 1,000 pages. Assumption only — see report.
AZURE_READ_USD_PER_PAGE = 0.0015

HEADING_RE = re.compile(r"^#{1,6}\s+\S", re.MULTILINE)
# Rough linearized-table signal in native text: 3+ consecutive lines carrying
# 2+ runs of 2+ spaces (column gaps) — proxy only, verified by eye.
TABLE_GAP_RE = re.compile(r"(?:.* {2,}\S.*\n){3,}")


def sample_corpus(corpus: Path, n: int, seed: int) -> list[Path]:
    pdfs = [p for p in corpus.rglob("*.pdf") if p.is_file()]
    by_group: dict[str, list[Path]] = {}
    for p in pdfs:
        try:
            group = p.relative_to(corpus).parts[0]
        except (ValueError, IndexError):
            group = "other"
        by_group.setdefault(group, []).append(p)
    rng = random.Random(seed)
    picked: list[Path] = []
    groups = sorted(by_group)
    # Round-robin across top-level groups, largest-first within group, then a
    # seeded shuffle so sizes mix instead of clustering.
    per_group = [sorted(g, key=lambda p: p.stat().st_size, reverse=True) for g in (by_group[k] for k in groups)]
    idx = 0
    while len(picked) < n and any(len(g) > idx for g in per_group):
        for g in per_group:
            if len(picked) >= n:
                break
            if idx < len(g) and g[idx] not in picked:
                picked.append(g[idx])
        idx += 1
    rng.shuffle(picked)
    return picked[:n]


def analyze(pdf: Path, corpus: Path) -> dict:
    started = time.perf_counter()
    try:
        result = extract(str(pdf))
        error = None
    except Exception as exc:  # noqa: BLE001 — spike must not die on one file
        result = {"extractor": "failed", "pageCount": 0, "pages": []}
        error = f"{type(exc).__name__}: {exc}"
    elapsed = time.perf_counter() - started
    pages = result.get("pages", [])
    texts = [str(p.get("text") or "") for p in pages]
    native_chars = sum(len(t) for t in texts)
    ocr_pages = sum(1 for p in pages if p.get("needsOcr"))
    headings = sum(len(HEADING_RE.findall(t)) for t in texts)
    table_hits = sum(1 for t in texts if TABLE_GAP_RE.search(t))
    page_count = result.get("pageCount", len(pages))
    return {
        "file": str(pdf.relative_to(corpus)),
        "bytes": pdf.stat().st_size,
        "extractor": result.get("extractor"),
        "pages": page_count,
        "nativeChars": native_chars,
        "ocrPages": ocr_pages,
        "ocrPageRatio": (ocr_pages / page_count) if page_count else 0.0,
        "headingsInMarkdown": headings,
        "pagesWithTableSignal": table_hits,
        "seconds": round(elapsed, 2),
        "azureOnlyPages": page_count,
        "hybridAzurePages": ocr_pages,
        "azureOnlyUsd": round(page_count * AZURE_READ_USD_PER_PAGE, 4),
        "hybridUsd": round(ocr_pages * AZURE_READ_USD_PER_PAGE, 4),
        "error": error,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default=str(Path.home() / "Downloads/vic-judgments-demo"))
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=".scratch/pdf-pipeline-remainder/spike")
    args = ap.parse_args()

    corpus = Path(args.corpus)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    picked = sample_corpus(corpus, args.n, args.seed)
    (out / "sample.csv").write_text(
        "file\n" + "".join(f"{p.relative_to(corpus)}\n" for p in picked), encoding="utf-8"
    )
    rows = [analyze(p, corpus) for p in picked]
    (out / "results.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")

    ok = [r for r in rows if not r["error"]]
    tot_pages = sum(r["pages"] for r in ok)
    tot_ocr = sum(r["ocrPages"] for r in ok)
    print("| file | pages | ocr_pages | native_chars | headings | secs |")
    print("|---|---|---|---|---|---|")
    for r in rows:
        name = Path(r["file"]).name
        name = (name[:47] + "…") if len(name) > 48 else name
        err = f" ({r['error']})" if r["error"] else ""
        print(
            f"| {name} | {r['pages']} | {r['ocrPages']} | {r['nativeChars']} "
            f"| {r['headingsInMarkdown']} | {r['seconds']} |{err}"
        )
    print()
    print(f"docs={len(ok)}/{len(rows)} pages={tot_pages} ocr_pages={tot_ocr} "
          f"ocr_ratio={(tot_ocr / tot_pages if tot_pages else 0):.2f}")
    print(f"est_azure_only=${sum(r['azureOnlyUsd'] for r in ok):.4f} "
          f"est_hybrid=${sum(r['hybridUsd'] for r in ok):.4f} "
          f"(@ ${AZURE_READ_USD_PER_PAGE}/page)")


if __name__ == "__main__":
    main()
