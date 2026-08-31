# Mini-Paralegal docs

| Doc | What it is |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Participants, coref, bag-of-chunks similar-cases, schema |
| [UI.md](./UI.md) | Case / graph / re-process UI |
| [pdf-pipeline.md](./pdf-pipeline.md) | **Locked** PDF extract: PyMuPDF4LLM + Azure `ocr_function` |
| [rag.md](./rag.md) | Hybrid search, eval, ingest (overlap, metadata, contextual prefix, side-cards) |
| [eval/golden.schema.json](./eval/golden.schema.json) | Contract for labeled queries (`chunk_uid` when evals land) |
| [eval/golden.example.json](./eval/golden.example.json) | Synthetic example — real gold stays off-git |
