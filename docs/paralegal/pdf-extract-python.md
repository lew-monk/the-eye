# PDF extract: Python vs pdf-lib OCR

Implementation notes. Default production path does **not** need Python.

Related: [pdf-pipeline.md](./pdf-pipeline.md), `ENVIRONMENT_VARIABLES.md`.

## Roles

| Piece | Role |
|---|---|
| **pdf-lib** (Node, `packages/core/src/services/ocr/pdf-chunker.ts`) | Split / copy PDF pages so Azure stays under size/page limits. Never OCRs. |
| **Azure Document Intelligence** | The OCR engine (`prebuilt-read`). |
| **Python / PyMuPDF** (`packages/coreference-worker/src/pdf_extract.py`) | Only for `PDF_EXTRACTOR=pymupdf4llm-hybrid`: native digital-page text + `needsOcr` flags. |

## Current flags

| Variable | Default | Meaning |
|---|---|---|
| `PDF_EXTRACTOR` | `azure` | `azure` = pdf-lib split → Azure. `pymupdf4llm-hybrid` (aliases: `hybrid`, `pymupdf`) = native extract then Azure only on `needsOcr` pages. |
| `PDF_EXTRACT_FALLBACK` | `azure` | On hybrid failure, run the Azure strategy. Set `none` to fail closed. |
| `PDF_EXTRACT_PYTHON` | `python3` | Interpreter used to spawn `pdf_extract.py`. Unused on the Azure path. |
| `PDF_EXTRACT_SCRIPT` | auto | Override path to `pdf_extract.py`. |

There is **no** `python --version` probe. Hybrid spawns `PDF_EXTRACT_PYTHON` with the script. If spawn fails and fallback is `azure`, OCR continues on Azure.

The API/OCR image is `oven/bun:1` and does not install Python. Hybrid in that container will fail-then-fallback unless Python+PyMuPDF are added.

The coreference-worker image (`FROM python:3.11`) is for spaCy/coref/chunking, not OCR. `pyproject.toml` `requires-python = ">=3.12"` is packaging metadata and is out of sync with the 3.11 image.

## Implementation

1. Keep `PDF_EXTRACTOR=azure` (or unset) in compose/prod until hybrid is wired with Python in the OCR runtime.
2. Do not document `PDF_EXTRACT_PYTHON` as required for Azure OCR.
3. If hybrid stays off: stop spawning Python from the Node OCR worker; treat `native-extract.ts` as hybrid-only.
4. If hybrid is turned on: install PyMuPDF in the process that runs `runNativeExtract` (today: the API/OCR worker), or call the coreference-worker instead of `python3` on the Bun image.
5. Align coreference-worker Docker Python with `requires-python` (3.11 image vs `>=3.12`) as a worker packaging fix, not an OCR fix.
