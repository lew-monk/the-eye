# Spike: Azure-only vs hybrid extract on 20 real PDFs

Date: 2026-10-04. Script: `packages/coreference-worker/spike/run_spike.py`
(seed 42, round-robin across `coroners` / `supreme-court`, size-spread).
Raw: `.scratch/pdf-pipeline-remainder/spike/results.json` + `sample.csv`.

## Method
For each PDF, ran the current hybrid native extract (`pdf_extract.extract` →
`pymupdf4llm.to_markdown(page_chunks=True, use_ocr=False)`, `pymupdf` fallback)
and recorded pages, native chars, `needsOcr` pages, ATX headings in the
markdown, timing. No Azure calls were made (zero spend); Azure cost is
estimated at the `prebuilt-read` list price of **$0.0015/page**, azure-only =
all pages, hybrid = `needsOcr` pages only.

## Result (20/20 docs extracted, 1138 pages, ~187s total)
- Fully digital (0 OCR pages): **15 docs**
- Mixed (cover page / exhibits scanned): **2 docs** (+1 with 1 OCR page)
- Fully scanned (>90% OCR pages): **3 docs**
- OCR-page ratio overall: **57/1138 = 5%**
- Est. Azure cost: **$1.71 azure-only → $0.09 hybrid (−95%)**
- Slowest doc: 172 pages in 56s (native only; acceptable for background ingest)

## Per plan question
- **Char error**: no ground truth, so measured coverage instead — 95% of pages
  yield full native text; the 3 scanned docs yield ~0 native chars and route
  wholly to Azure, which is the correct behavior. Spot-check recommended on 3–5
  docs before locking thresholds.
- **Table rows**: native markdown **preserves pipe tables** (spot-check: 75/172
  pages in `Allianz Amended Defence`, 3/28 in `Lieberman v Crown`). The spike
  script's space-gap proxy found 0 — wrong detector for markdown output; pipe
  detection is the right one. Tables do not need Azure to survive.
- **Heading list**: **806 ATX headings** across 20 docs (avg ~40/doc) already
  present in the markdown output — the raw material for heading-bounded
  chunking (slice C) exists today.
- **Azure $/doc**: ~$0.085/doc azure-only vs ~$0.004/doc hybrid at this mix.

## Recommendation
- The hybrid routing works: 5% OCR ratio, −95% cost, tables and headings
  intact in native output. Proceed with slice A (rich extract: boxes, heading
  metadata, table blocks) then B/C (persist + heading-bounded chunks).
- **Defer slice D** (in-Python Azure `ocr_function`): with only 5% of pages
  needing OCR, whole-page Azure routing via Node/pdf-lib is sufficient;
  region-level OCR adds worker credential wiring for little gain. Revisit only
  if mixed-page quality (text + exhibits on one page) proves bad.
- Follow-up: fix threshold validation — `MIN_TEXT_CHARS=40` + replacement-ratio
  heuristic correctly flagged the scanned docs here, but confirm on the 2 mixed
  docs that exhibit-only pages don't pollute the legal body (the `picture`
  exclusion in slice A covers this).
