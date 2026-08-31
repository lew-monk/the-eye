# PDF → text pipeline (locked)

**Status:** design locked. Not implemented yet. Feature flag when it ships: `PDF_EXTRACTOR=azure | pymupdf4llm-hybrid`.

**Locked extractor:** [PyMuPDF4LLM](https://pymupdf.readthedocs.io/en/latest/pymupdf4llm/) owns native text, layout, headers, tables, and “this page needs OCR.” **`ocr_function` = Azure Document Intelligence.** Digital pages never leave the box. Scan / garbled regions only hit Azure. Tesseract is not the production OCR path.

Related: [rag.md](./rag.md) (retrieval / eval), [ARCHITECTURE.md](./ARCHITECTURE.md) (coref + similar-cases).

---

## Why change

Today: every PDF goes to Azure **`prebuilt-read`**. `pdf-lib` only **splits** for 4MB / 50-page limits. We store one string `fullContent.content`. Downstream chunking is `\n\n` + 512-token pack.

That:

- Pays Azure on born-digital judgments that already have a text layer
- OCRs stamps, signatures, and exhibit photos into the legal body (NER / embed noise)
- Linearizes tables (appearances, costs, authorities)
- Treats running headers (“THE REPUBLIC OF KENYA”) as substance
- Cannot split on **Issues / Holding / Orders**

---

## What PyMuPDF4LLM gives us

| Layer | Role |
|---|---|
| PyMuPDF (`fitz`) | Native text, bboxes, images, table lines, page render. Not an OCR engine. |
| PyMuPDF4LLM | Markdown / JSON / TXT, layout GNN, auto OCR routing, header/footer drop, `page_chunks` |

OCR behaviour we rely on (`use_ocr=True`):

- Skip OCR when the page has selectable text
- Hybrid OCR: only regions without a text layer (or garbled `����`) go to the engine
- Custom **`ocr_function`**: Azure DI for those regions
- `force_ocr=True` only if we distrust a bad Word→PDF text layer
- `header=False`, `footer=False` drops repeating letterhead / page numbers

Do **not** pull LlamaIndex or LangChain. Consume `to_markdown` / `to_json` in the existing Python worker and POST into `document_chunks`.

---

## Images

Azure `prebuilt-read` today OCRs coats of arms, wet signatures, ID photos, WhatsApp screenshots. That text becomes fake participants and similar-case pollution.

With this pipeline:

- Layout boxes of class `picture` are **not** merged into body text
- Extract to object storage (`exhibits/…`); optional later OCR as a **child document**
- Azure OCR is only for **text-like** scan regions, not every image on the page

---

## Tables

`prebuilt-read` linearizes cells. A 3-column appearances table becomes one nonsense sentence; coref and citations break.

With this pipeline:

- Detected tables → GitHub markdown (one **atomic** chunk, no mid-row split)
- Still weak on **borderless** legal “tables.” If `page_boxes` look tabular and MD detection fails, send **that page** to Azure `prebuilt-layout`
- Side-cards (see rag.md) store row cells for exact recall of amounts / statutes; generation still cites the markdown table chunk

---

## Situation-aware chunking

Largest RAG win — bigger than “faster OCR.”

| Signal | Use |
|---|---|
| Section headings (`#` / `##`, TOC, layout titles) | Split on Issues / Holding / Orders / Reasoning. Label `section` |
| Page header/footer | Drop; do not embed |
| Tables | One chunk per table |
| Pictures | Omit from body |
| Multi-column | Trust layout reading order |
| In-section overlap | 10–20% token overlap **inside** a long section only. Never overlap across headings. Never overlap into/out of a table |

**Legal catch:** “IN THE HIGH COURT OF KENYA AT NAIROBI” is a **page** header (`header=False`). “ISSUES FOR DETERMINATION” is a **section** header (`IdentifyHeaders` / layout). Using font size alone will fake a `#` on every page.

Chunk recipe:

1. Markdown + JSON boxes from pymupdf4llm
2. Drop page header/footer
3. Walk ATX headings + table/picture boxes
4. Emit retrieval chunks: heading-bounded; 512-token **subchunks inside** a section if needed; whole table = one chunk
5. `parent_chunk_index` = section; `position_weight` from `weights.yaml` by section (holding > facts)

---

## Architecture

```
PDF
  └─ pymupdf4llm (layout on, header=False, footer=False, use_ocr=True)
        ocr_function = Azure Document Intelligence
        │
        ├─ digital pages → native markdown + JSON boxes
        ├─ scan / garbled regions → Azure only
        ├─ tables → MD table + side-card rows
        └─ pictures → object storage (not body text)
              │
              ▼
        Heading-bounded chunks
        + 10–20% overlap inside a section
        + template situating prefix (embed only)
        + metadata + deterministic chunk_uid
              │
              ▼
        document_chunks + side-cards
              │
              ▼
        coref / embed / hybrid search (rag.md)
```

`pdf-lib` remains only to batch **Azure-bound scan pages** under size/page limits.

---

## Implementation order

1. Spike ~20 real PDFs (digital vs scan): Azure-only vs this hybrid (char error, table rows, heading list, Azure $ / doc).
2. Python helper beside the coref worker. Flag `PDF_EXTRACTOR=azure|pymupdf4llm-hybrid`.
3. Persist markdown + `page_boxes`, not only `fullContent.content`.
4. Heading-bounded chunks + in-section overlap; map headings → `section`; `chunk_uid`.
5. Wire `ocr_function` to existing Azure client (same credentials, prefer `prebuilt-layout` for OCR pages).

Do not replace Azure entirely. Do not keep flat 512-token packing once headings exist.
