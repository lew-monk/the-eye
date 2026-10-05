# PRD: PDF pipeline remainder (pdf-pipeline.md items 1–5)

## Status
Slices A–C built on branch `feat/pdf-pipeline-remainder` (spike E done earlier).
- **A (rich extract):** `pdf_extract.py` emits per-page `markdown`, `headings[]`
  (md/HTML wrappers stripped), `tables[]` (single MD block), `pictures[]`
  with bboxes, `boxes[]`. Contract keys (`pageIndex/text/needsOcr`) unchanged.
  `tests/test_pdf_extract.py` (9 tests, pymupdf-generated fixtures).
- **B (persist):** `NativePage`/`HybridPageRecord` carry the rich signals into
  `structuredData.pages` (`hybrid-merge.ts`); `fullContent.content` untouched
  for existing consumers. Passthrough + legacy-shape tests.
- **C (heading chunks):** migration `0016` (`section`, `chunk_uid` + unique
  index); `paralegal.chunk_text(..., section_headings, document_id)` splits on
  ordered heading matches, atomic table chunks, 15% in-section overlap
  (never across sections/tables), `chunk_uid=sha256(doc|section|hash|v1)`;
  legacy path byte-identical when no headings. `ChunkIngest` + store
  passthrough; `getExtractedText` exposes `sectionHeadings`; worker threads
  them through. Proven on VSC 643: 35 headings → 36 sections, 78 chunks.
- **Validation:** mixed-doc dump confirms thresholds (scanned exhibits →
  Azure, redacted blanks → empty, filing stamps → native); re-run spike shows
  identical routing ( extracting ~2x slower from find_tables/bboxes, still
  background-fine).
- **Deferred (D):** in-Python Azure `ocr_function` — unjustified at 5% OCR ratio.

## Evaluation: what is done vs pending

### DONE — item 2 (partial): Python helper + strategy flag
- `packages/coreference-worker/src/pdf_extract.py` (100 lines): native per-page text + `needsOcr` flags via `pymupdf4llm.to_markdown(page_chunks=True, use_ocr=False)` with `pymupdf` fallback.
- Node wiring in `packages/core/src/services/ocr/extract/` (`factory.ts`, `hybrid-strategy.ts`, `hybrid-merge.ts`, `native-extract.ts`) + tests; `PDF_EXTRACTOR` documented in `.env.example`, `ENVIRONMENT_VARIABLES.md`, `docker-compose.dev.yml`.
- Limitation: output is `{ pageIndex, text, needsOcr }` only — no boxes, headings, tables, or pictures.

### PENDING — item 1: 20-PDF spike
No harness, no results in repo. Needs a corpus (open: does `~/Downloads/vic-judgments-demo/` from the ingestion plan exist?).

### PENDING — item 3: persist markdown + `page_boxes`
- `documents` table (`packages/shared/src/schemas/documents.ts`) has `fullContent jsonb` (could carry it without migration) but nothing writes markdown/boxes.
- `pdf_extract.py` does not emit boxes; `ChunkIngest` (`apps/api/src/modules/internal/chunks/model.ts:6-15`) has no `section`/`chunk_uid` fields.

### PENDING — item 4: heading-bounded chunks + overlap + `section` + `chunk_uid`
- `document_chunks` has `position_weight` + `parent_chunk_index` but no `section` / `chunk_uid` columns.
- Chunking happens in the Python worker; no heading-aware splitting or in-section overlap exists anywhere. `rag.md:105-109` defines `chunk_uid = sha256(document_id | section | text_hash | chunker_version)`.

### PENDING — item 5: `ocr_function` → Azure inside Python
By design so far: Node sends whole `needsOcr` pages to Azure via pdf-lib (`hybrid-strategy.ts:34`). Region-level hybrid OCR inside `pymupdf4llm` (`use_ocr=True` + Azure `ocr_function`) is not wired and needs Azure creds in the worker env.

## Proposed build order (vertical slices, each independently shippable)

- **A. Rich extract output (Python only, no migration).** Extend `pdf_extract.py` JSON per page: `markdown`, `headings[]` (level + text), `tables[]` (markdown, one per table), `blocks[]` with bbox + kind (`text|table|picture|header|footer`), `pictures[]` (bbox, xref). Pure function + `test_pdf_extract.py` on fixture PDFs. Consumers ignore new keys until later slices.
- **B. Persist markdown + `page_boxes`.** Worker POSTs markdown/boxes; store in `documents.fullContent` (jsonb, no migration) with `extractionVersion` bump. Verify on one doc end-to-end.
- **C. Heading-bounded chunking + `chunk_uid`.** Migration: `section text`, `chunk_uid text` (+ unique index) on `document_chunks`. Worker: split on headings, whole table = one chunk, 10–20% overlap inside sections only, `parent_chunk_index` = section chunk. Extend `ChunkIngest` + `ChunksService.store` passthrough. `chunk_uid` per `rag.md` formula.
- **D. Azure `ocr_function` in Python.** Only if page-level OCR proves too coarse/noisy: pass Azure client as `ocr_function`, keep `PDF_EXTRACT_FALLBACK` semantics. Needs worker env wiring.
- **E. 20-PDF spike harness.** Script comparing azure-only vs hybrid on char error / table rows / heading list / Azure $ per doc; report committed to `docs/paralegal/`. Blocked on corpus.

## Acceptance criteria (slice A)
- [ ] `pdf_extract.py` emits the extended schema on digital, scanned, and mixed fixture PDFs without calling Azure.
- [ ] `test_pdf_extract.py` covers: heading detection, table → single MD block, picture excluded from body text, `needsOcr` behavior unchanged.
- [ ] Existing `factory` / `hybrid-strategy` / `hybrid-merge` tests still green (new keys ignored downstream).
- [ ] `ruff` + existing Python test setup pass (note: quality plan items 8–10 — Ruff/Pyright — are themselves pending; match whatever the worker currently uses).

## Out of scope
- Retrieval changes (`rag.md` 1.x–7.x), search ACL / authz (quality item 6), picture OCR as child documents, borderless-table `prebuilt-layout` fallback (needs boxes first — revisit after slice A).
