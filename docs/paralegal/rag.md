# Search & RAG Pipeline Plan

Plan for upgrading The Eye from **case-similarity over embeddings** to a **citation-accurate legal RAG stack**. Citation accuracy outranks fluency. Implement in checklist order; do not skip evaluation just because retrieval "feels" better.

**PDF extract (locked):** PyMuPDF4LLM + Azure as `ocr_function`. Spec: [pdf-pipeline.md](./pdf-pipeline.md). This file owns retrieval, eval, and **chunk ingest** (overlap, metadata, `chunk_uid`, contextual prefix, table side-cards).

**Current baseline (do not assume we are starting from zero):**

| Piece | Today |
|---|---|
| Dense embeddings | Per-chunk vectors in `document_chunks` (`nomic-embed-text` 768-d in dev, `text-embedding-3-small` 1536-d in prod) stored in a **3072-d** pgvector column |
| Chunking | Paragraph-aware, sentence fallback, 10% token headroom; often **one chunk for short docs** |
| Text stored | `document_chunks.text` + `chunk_text_hash` (hash unused for skip-on-reprocess) |
| Normalization | Entity mentions replaced with role tokens (`[JUDGE]`, `[PLAINTIFF]`, …) **before** embedding |
| Similarity | Case↔case: entity overlap + bag-of-chunks Weighted Mean-of-MAX + optional metadata (`α/β/γ` weighted sum) |
| Index | No ANN index in schema today; architecture doc recommends IVFFlat then HNSW at 100k+ |
| Sparse / rerank / RAG eval | None |
| Freshness | `embedding_version` + manual / batch re-process; POSTs for participants vs chunks are independent |
| Coref | Document-local clusters; cross-doc join via `normalized_name` |
| Position weights | `weights.yaml` + `position_weight` column; **not applied at rank time** |

Two products share this index. Keep them distinct:

1. **Similar cases** — document↔document ranking (existing).
2. **Q&A RAG** — query↔chunk retrieval + grounded generation with citations (new).

Do not collapse them into one scoring function.

---

## 1. Search on embeddings — hybrid retrieval

Do **not** rely on pure cosine. Legal queries live on exact tokens (statute numbers, party names, citations) that role-token embeddings deliberately blur.

```
Query
  ├─ classify (similar-case | fact-find | citation-lookup | abstain)
  ├─ metadata pre-filter (case, doc type, date, participant, jurisdiction)
  ├─ dense ANN   → top N  (entity-normalized chunk vectors)
  ├─ sparse BM25 → top N  (raw chunk text + party names + citations)
  └─ RRF fusion  → top 50
        ├─ entity/weight boost (query-relevant participants only)
        └─ cross-encoder rerank → top 5–8
              └─ parent-section expand → generator + citation check
```

### 1.1 Dense retrieval

- Keep existing embeddings as the dense arm.
- Add **HNSW** (`vector_cosine_ops`, start `m=16`, `ef_construction=200`) once chunk count leaves sequential scan. Tune `ef_search` against **our** recall@k, not library defaults.
- IVFFlat (`lists=100` in the original architecture) needs periodic rebuild as n grows and is a poor fit for incremental ingest. Prefer HNSW for the query path.
- **pgvector column width is fixed** (`vector(3072)`). Same-model zero-padding does **not** change cosine: `cos([a,0],[b,0]) = cos(a,b)`. What poisons retrieval is **mixing models** in one `<=>` scan, or truncating a longer vector. Store native width on the row, pad on write/query, filter `embedding_model`. Blue/green **column/index swap** when the model (and native width) changes.

### 1.2 Sparse retrieval

- BM25 / Postgres `tsvector` + GIN on **raw** chunk text, not role-token text.
- Extra fields: party names, statute tokens, case citations, section headings.
- This arm exists **because** dense search replaces names with `[PLAINTIFF]`. Without sparse, "Otieno" and "Cap 22 s. 3" will miss.

### 1.3 Fusion

- Reciprocal Rank Fusion, not a naive weighted sum of cosine + BM25 + entity overlap.
- Existing similar-case `α/β/γ` is exactly that naive mix — fine as a **feature** into a later ranker, not as the combiner of incomparable score scales.
- Default RRF `k=60`. Log per-arm ranks so eval can see which arm saved the hit.

### 1.4 Entity / weight-aware boosting

- Boost chunks that mention **query-relevant** high-weight participants, not globally frequent ones.
- Mention-frequency (`mention_freq_norm` today) is not relevance. A judge named in every paragraph should not drown a one-mention defendant the query asked about.
- Resolve query entities against `normalized_name` + aliases, then boost. Cap the boost so it cannot override a sparse exact-match on a statute.

### 1.5 Reranker

- After hybrid top-50, cross-encoder (`bge-reranker-v2-m3` locally, or Cohere rerank in prod) → top 5–8.
- Feed the reranker **raw legal text**, not `[PLAINTIFF]` tokens.
- This is usually the largest accuracy lift. Never rerank the full corpus.

### 1.6 Metadata pre-filter

- Filter **before** ANN: document type, date range, case ID, participant, jurisdiction, superseded flag.
- Post-filter wastes HNSW and lets similar-but-wrong docs occupy top-k.

### 1.7 Query understanding (missed in the original brief)

- **Rewrite / expand** with constraints: HyDE is useful for "can they evict me" → tenancy language, but a free-form hypothetical will **invent statutes**. Expand to legal phrasing + synonym statutes from a allow-list, not from an unconstrained LLM.
- **Dual query encoding**: one raw query (sparse + rerank), one optionally role-normalized query (dense), because documents were embedded after entity substitution.
- **Parent-child retrieval**: index clause-sized children; expand to the parent section/paragraph for generation so the model sees the definition that a split clause lost.
- **Query classification**: similar-case vs extractive Q&A vs "list participants" vs abstain. Route to the existing similar-cases scorer when appropriate instead of forcing everything through RAG.

### 1.8 Ingest (locked with the PDF pipeline)

See [pdf-pipeline.md](./pdf-pipeline.md) for extract. These ingest rules apply once markdown+boxes exist.

**Overlap 10–20%.** Apply only **inside** a long section after heading-bounded splits. Never overlap across Issues/Holding/Orders. Tables stay atomic.

**Chunk metadata** (filter **before** HNSW). No equity “ticker.”

| Field | Meaning |
|---|---|
| `source` | `native` \| `azure-ocr` |
| `section` | `facts` \| `issues` \| `holding` \| `reasoning` \| `orders` \| `table` \| `other` |
| `page` | 1-based |
| plus document | `case_id`, `document_type`, `court`, date, storage key, `is_current` |

**Deterministic `chunk_uid`.** Serial `id` breaks gold on re-chunk.

`chunk_uid = sha256(document_id | section | text_hash | chunker_version)`

Gold labels store `chunk_uid`. Same text + same chunker version → same uid.

**Contextual retrieval (cheap first).** Embed `template_prefix + chunk`. Cite and generate from **raw** chunk only.

Template (no LLM):

`Case {caseNumber} ({court}, {date}), {documentType}, section {heading}. Parties: {plaintiff} v {defendant}.`

LLM-written 1–2 sentence prefixes only if gold Recall@k is still weak; constrained to template fields + heading. Never invent a case name.

Role-token embeddings stay for **similar-cases**. Situating prefix is for **query RAG**.

**Table / number side-cards.** Markdown table = one prose chunk (citation). Extra rows in a side index: cells, MONEY/DATE/LAW. Retrieve via union into RRF. Embeddings will not reliably find “KES 2,400,000.”

Target query path:

```
metadata pre-filter
  ├─ dense (prefixed text, one embedding model)
  ├─ sparse BM25 (raw chunk text)
  └─ side-cards (tables / amounts / statutes)
        → RRF → rerank on RAW text → generate + span citations
```

---

## 2. Evaluation matrix

Split **retrieval** from **generation**. A fluent wrong citation is a generation failure; a missing chunk is retrieval. Conflating them hides the fix.

### 2.1 Retrieval

| Metric | What it catches | Target (v1) |
|---|---|---|
| Recall@k (k=5, 10, 50) | Right chunks in the hybrid shortlist | Recall@50 ≥ 0.90 on gold |
| Precision@k | Noise in top-k | Precision@8 ≥ 0.60 |
| MRR / NDCG@10 | Best chunk near the top | MRR ≥ 0.70 |
| Context precision | Retrieved chunks that are actually needed | Track; no hard gate until gold set is stable |
| Context recall | All needed info retrieved at all | Context recall ≥ 0.85 |
| Arm ablation | Dense-only vs sparse-only vs RRF vs RRF+rerank | RRF+rerank beats each arm |

### 2.2 Generation

| Metric | What it catches | Target (v1) |
|---|---|---|
| Faithfulness / groundedness | Answer only uses retrieved context | Fail the answer if unsupported |
| Answer relevancy | Addresses the query | Track |
| **Citation accuracy (span-level)** | Cited chunk actually contains the claim | **Ship blocker.** Doc-level "this PDF was retrieved" is not enough |
| Citation coverage | Every material claim has a citation | Required in legal UI |
| Abstention | "Not found" when corpus has no answer | False-answer rate on negative set = 0 |

### 2.3 Tooling

- **Golden set**: 50–100 real queries with labeled source **chunks** (`chunk_uid` + char offsets). Include:
  - exact citation / statute lookups
  - party-name queries (sparse must win)
  - plain-language queries (rewrite/HyDE)
  - similar-case queries
  - **negatives** (answer not in corpus)
  - OCR-noisy chunks
  - amended / superseded versions
- RAGAS or DeepEval for automation. **Do not use LLM-as-judge as the source of truth for citations** — use span overlap / entailment against the cited chunk. LLM-as-judge is backup for relevancy only.
- PII: golden set is derived from real filings. Keep it off git; store hashed IDs + redacted text in a private bucket.
- Run the suite on **every** change: chunking, embed model, RRF k, reranker, filters. Treat it as CI, not a one-off notebook.

### 2.4 Scoring rubric (per query)

| Score | Retrieval | Generation | Citation |
|---|---|---|---|
| 3 | Gold chunk in top 5 | Fully answers, grounded | Every claim span-supported |
| 2 | Gold in top 50, not top 5 | Partial / verbose | Citations present, one weak |
| 1 | Gold missing | Tangential | Hallucinated or mismatched cite |
| 0 | Empty / wrong case | Fabricated | Invented authority |

Ship rule: **no 0s on citation; no 1s on the negative set.**

---

## 3. Pitfalls

### From the original brief (keep)

- **Chunking breaks legal structure** — mid-clause / mid-definition splits. Use OCR layout + section/clause/paragraph boundaries, overlap on purpose. Apply `weights.yaml` at rank time (reserved today, unused).
- **OCR errors propagate** — embed OCR confidence; exclude or flag low-confidence chunks from high-stakes answers.
- **Lost in the middle** — inject 5–8 reranked chunks, most relevant first and last, not top 50.
- **Hallucinated citations** — faithfulness gate before render; show the source excerpt next to the claim.
- **Entity / coreference drift** — "the plaintiff" / "Mr. Smith" / "he" across chunk boundaries. Coref is document-local; retrieval that splits a cluster will drop aliases.
- **Near-duplicate chunks** — same clause across document versions. Dedup with `chunk_text_hash` + minhash/simhash **before** index.
- **Query–chunk vocabulary mismatch** — constrained rewrite, not unconstrained HyDE.
- **Stale embeddings** — amended docs; see §5.
- **Weight bias** — frequency ≠ query relevance.
- **No abstention testing** — negative queries must return "not found".

### Additional (The Eye specific)

- **Role-token dense index hides the tokens users type.** Party names and statutes must live on the sparse arm and in the reranker input.
- **Padded 3072-d vectors.** Same-model pad is cosine-safe. Mixing 768 and 1536 in one `<=>` scan is invalid. One model per query; record `embedding_dimensions`.
- **Independent participant vs chunk POSTs.** Search must degrade when embeddings are missing (`embedding IS NULL`) instead of silently ranking on entity overlap only without saying so.
- **`normalized_name` collisions.** `otieno` will merge unrelated people across the corpus. Require a second key (role + case + time window) before boosting or graph-joining.
- **One-chunk documents.** Short filings skip structure-aware chunking today; Q&A then retrieves a whole judgment. Always emit section-level children even when the doc fits the embed context.
- **No section labels yet** (`facts` / `issues` / `holding` / `reasoning` in architecture "future"). RAG without holding-vs-facts distinction will quote recitals as holdings.
- **Cross-doc coref is name-join, not real coref.** Graph retrieval will be wrong for common Kenyan names until entity resolution is stronger than string normalize.
- **Privilege / ACL.** Retrieved context must respect case membership and privileged flags. A high cosine to another user's matter is a security bug, not a good hit.
- **Temporal validity.** Amended pleadings and repealed statutes. Retrieve "as of date" or mark superseded; never present an old version as current (see soft-delete).
- **Eval leakage.** Golden queries must not be tuned on the same cases used to pick reranker thresholds without a held-out split.
- **Generator sees normalized text.** If we pass `[PLAINTIFF]` into the LLM, citations will quote tokens the user never wrote. Generation context = raw text + metadata.
- **Similar-case weighted sum vs RAG RRF.** Do not "fix" similar-cases by blindly replacing Mean-of-MAX with RRF without an eval slice for that product.
- **Reranker latency on CPU.** Budget GPU or cap candidate set; a 50-doc cross-encoder on CPU will blow the API SLO.
- **Ingestion vs query coupling.** Large OCR jobs already go through BullMQ; keep embed/NER on that queue so search p99 does not move with upload volume.

---

## 4. Query optimization & efficiency

- **Two-stage retrieval only**: cheap dense+sparse → 50; expensive rerank → 5–8.
- **HNSW `ef_search` / `M`**: sweep on production-like chunk counts; plot recall@50 vs p95.
- **Metadata pre-filter** first (pgvector iterative index scans still benefit from a smaller bitmap).
- **Semantic query cache**: cache `{filter_key, query_embedding}` → fused ids if cosine(q, q') > threshold **and** filters match. Exact-match cache is not enough.
- **Batch embed** on ingest (GPU/Ollama batch). Never embed one chunk per HTTP call in prod.
- **Async ingest**: OCR → chunk → embed → NER already belongs on BullMQ; split retryable steps (embed fail should not drop participants — already the design).
- **Don't load top-50 full texts into the LLM.** Rerank on short strings; expand only the final 5–8 to parent sections.
- **Connection pooling / prepared ANN statements.** pgvector + HNSW under bursty similar-case traffic.
- **SLO**: define p95 for search (e.g. 300ms without rerank, 800ms with) and fail the build if a change blows it.

---

## 5. Timeliness of embeddings

- **Incremental indexing**: `chunk_text_hash` already exists — skip re-embed when hash + `embedding_model` match.
- **Event-driven re-embed**: on upload / amendment / OCR re-run, enqueue; no overnight-only cron as the primary path. Cron is a backlog sweeper.
- **Model versioning**: `embedding_model` + `embedding_version` already on docs. On upgrade: build a shadow column/index → backfill → swap (blue/green). Never query mixed models.
- **Freshness metric**: time since last successful embed per document; alert on queue lag and on `embedding IS NULL` rate.
- **Soft-delete / supersede**: amended versions get `superseded_at` / `is_current`. Default search `is_current = true`. Keep old vectors for "as-filed on date" queries.
- **Partial failure**: if chunk POST fails after participants succeed, surface "index incomplete" on the case, not a confident similar-case list.

---

## 6. Implementation checklist

Work **one box at a time**. Each phase ends with the eval suite (or the subset that exists by then). Do not start a later phase while the previous exit criteria are red.

### Phase 0 — Foundations (unblocks everything)

- [ ] **0.1** Write 50–100 gold Q&A pairs with chunk ids + char offsets + negatives. Store off-git. Split train/dev/holdout. *(schema + example fixture landed; real labeled set still needed)*
- [x] **0.2** Confirm every searchable chunk has raw `text`, `chunk_text_hash`, `token_count`, `embedding_model`, OCR confidence (add column if missing).
- [x] **0.3** Stop treating padded 3072-d as interchangeable. Document actual dims per model; add a check that refuses to insert the wrong width.
- [x] **0.4** Always emit section/paragraph children even when the whole doc fits the embed window. Keep a parent_chunk_id. *(retrieval pack size default 512; `parent_chunk_index` column ready)*
- [x] **0.5** Apply `position_weight` at rank time (or delete the dead config).
- [ ] **0.6** Define search ACL: case membership + privileged flag on every retrieval path.
- [x] **0.7** Add `is_current` / `superseded_by` on documents.

**Exit:** gold set exists; we can retrieve a chunk by id and show its raw text.

### Phase 1 — Honest dense search

- [x] **1.1** HNSW index on the active model's vectors (or sequential scan with a logged plan until n requires it).
- [x] **1.2** Query embed uses the **same** model as the index. Reject mixed-model queries.
- [ ] **1.3** Optional second query encoding: role-normalize the query the same way docs were normalized; A/B on gold.
- [x] **1.4** Handle `embedding IS NULL` explicitly in similar-cases and RAG.
- [x] **1.5** Skip re-embed when `chunk_text_hash` + model match.

**Exit:** Recall@50 dense-only measured on gold. Baseline recorded.

### Phase 2 — Sparse + metadata filter

- [ ] **2.1** `tsvector` (or equivalent) on raw chunk text + names + citation strings. GIN index.
- [ ] **2.2** Metadata pre-filter API: case, type, date, participant, `is_current`.
- [ ] **2.3** Near-duplicate collapse on hash / minhash at index time.
- [ ] **2.4** Low OCR-confidence chunks: searchable with a flag, excluded from high-stakes generation.

**Exit:** Sparse-only Recall@50 on statute/name queries beats dense-only on that slice.

### Phase 3 — Hybrid fusion

- [ ] **3.1** RRF over dense + sparse ranks (`k=60`), return top 50.
- [ ] **3.2** Log per-arm rank for every query (eval + debug).
- [ ] **3.3** Entity boost only for participants resolved from the query; cap the boost.
- [ ] **3.4** Tighten `normalized_name` joins (role + case window) before using them as boost keys.

**Exit:** RRF Recall@50 ≥ each arm on the full gold set.

### Phase 4 — Rerank + generation context

- [ ] **4.1** Cross-encoder on raw text, candidates = fused top 50, output top 5–8.
- [ ] **4.2** Parent-section expand for the generator; lost-in-the-middle ordering (best first and last).
- [ ] **4.3** Constrained query rewrite (plain language → legal phrasing + allow-listed statute synonyms). No unconstrained HyDE into the index.
- [ ] **4.4** Latency budget: rerank p95 vs SLO; shrink candidate set if needed.

**Exit:** NDCG@10 and MRR beat Phase 3. p95 within SLO.

### Phase 5 — Grounded answers (RAG product)

- [ ] **5.1** Generator receives raw excerpts + document/section metadata only.
- [ ] **5.2** Every claim requires a citation `{document_id, chunk_index, start, end}`.
- [ ] **5.3** Faithfulness gate: drop or rewrite unsupported sentences; show excerpt in UI.
- [ ] **5.4** Abstention path + negative-set eval (score 0 answers forbidden).
- [ ] **5.5** Query router: similar-case stays on Mean-of-MAX / RRF-for-docs; Q&A uses this path.

**Exit:** Citation accuracy span-level meets ship rule. Negative set clean.

### Phase 6 — Eval as CI

- [ ] **6.1** RAGAS/DeepEval job + span-level citation checker.
- [ ] **6.2** Run on PR for chunking / model / RRF / reranker changes.
- [ ] **6.3** Dashboard: recall, MRR, citation accuracy, abstention, p95, embed lag.
- [ ] **6.4** Arm ablation report (dense / sparse / RRF / rerank) stored per run.

**Exit:** A pipeline change cannot merge if citation accuracy or Recall@50 regresses beyond the agreed delta.

### Phase 7 — Freshness & ops

- [ ] **7.1** Event-driven embed on upload/amendment; cron only sweeps `embedding IS NULL` / version skew.
- [ ] **7.2** Blue/green index swap runbook when `EMBED_MODEL` changes.
- [ ] **7.3** Freshness alert: ingest lag, null-embedding rate, `extraction_version` / `embedding_version` drift (UI already has the re-process hook).
- [ ] **7.4** Semantic query cache keyed by filters + embedding.
- [ ] **7.5** Batch embed in the Python worker (already on BullMQ).

**Exit:** New document searchable within minutes; model upgrades do not mix vectors.

### Phase 8 — Structure + PDF hybrid (see [pdf-pipeline.md](./pdf-pipeline.md))

- [ ] **8.1** PyMuPDF4LLM extract; `ocr_function=Azure`; persist markdown + `page_boxes`.
- [ ] **8.2** Heading-bounded chunks; in-section 10–20% overlap; `section` labels; `chunk_uid`.
- [ ] **8.3** Template situating prefix at embed time (raw text remains citation source).
- [ ] **8.4** Table/number side-cards; union into RRF after the BM25 arm exists.
- [ ] **8.5** Citation graph (`case_citations`) as an extra retrieval arm, fused with RRF — not another weighted sum.
- [ ] **8.6** User feedback (`similarity_feedback`) as a training signal for boost caps, not a silent score hack.
- [ ] **8.7** Stronger cross-document entity resolution than `normalized_name`.

**Exit:** Holding vs facts mix-ups drop on the gold slice labeled for that error.

---

## 7. Suggested next slices

**Search (can ship without new extract):** gold set (~30 queries, `chunk_uid`) → BM25 + existing HNSW + RRF → Recall@50 vs dense-only.

**Extract (pdf-pipeline.md):** spike 20 PDFs → `PDF_EXTRACTOR=pymupdf4llm-hybrid` with Azure `ocr_function` → heading-bounded chunks + template prefix.

Do not start LLM-per-chunk contextual summaries or a generator until those two have numbers.

---

## 8. Out of scope

- Replacing coref/NER models (this plan consumes their outputs).
- Training a custom legal embedding (`voyage-law-2` / `gte-Qwen2` = model swap under 7.2).
- LlamaIndex / LangChain wrappers.
- Tesseract as production OCR.
- Equity-style `ticker` metadata.

---

## 9. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Local reranker vs Cohere | Local first (`bge-reranker-v2-m3`) unless latency forces Cohere |
| 2 | BM25 store | Postgres `tsvector` until p95 fails |
| 3 | HyDE | Constrained rewrite only |
| 4 | Similar-cases scorer | Keep Mean-of-MAX until it has its own eval slice |
| 5 | pgvector width | Keep `vector(3072)` + pad + filter `embedding_model` |
| 6 | PDF extract | PyMuPDF4LLM hybrid; **`ocr_function=Azure`** |
| 7 | Contextual retrieval | Template prefix first; LLM prefix only if Recall@k still weak |
| 8 | Chunk overlap | 10–20% **inside** a section; never across headings or tables |
| 9 | Eval identity | `chunk_uid`, not serial `id` |
