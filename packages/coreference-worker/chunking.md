# Phase 2: Participant Extraction + Text Normalization + Chunking

## Overview

Extend the coreference worker to extract participants from coref clusters,
normalize text by replacing mentions with role tags, and chunk text for future
embedding.

## Files to modify

| File | Change |
|---|---|
| `requirements.txt` | Add `pyyaml` |
| `Dockerfile.dev` | Add `COPY patterns.yaml ./` + `COPY titles.yaml ./` |
| `Dockerfile.prod` | Same COPY additions |
| `docker-compose.dev.yml` | Add volume mounts for `patterns.yaml` + `titles.yaml` |
| `src/paralegal.py` | **NEW** — three extraction/normalization/chunking functions |
| `worker.py` | Load YAML at startup; call new functions after coref succeeds |

## Functions in `paralegal.py`

### `extract_participants(clusters, mentions, resolved_text, nlp)`

- For each coref cluster:
  - **Canonical name** = longest mention in the cluster (fullest form).
  - **Role matching** = iterate `patterns.yaml` roles in descending weight order;
    first regex match against canonical name wins.
  - **Name normalization** = strip known prefixes and suffixes from
    `titles.yaml`. If nothing remains, use canonical name as-is.
  - **Relevance score** = `mention_count / total_mentions * role_weight`,
    clamped [0, 1].
  - **Entity type** = `ner_hint` from matched pattern (PERSON / ORG);
    `null` if unmatched.
- Returns `list[dict]` matching `ParticipantModel.body` schema.

### `normalize_text(resolved_text, participants, mentions)`

- Sort all mentions by length descending (longest first).
- For each mention, determine its participant's role from the extracted list.
- Replace mention text in `resolved_text` with `[ROLE]` tag.
- Mentions whose participant has no matched role → `[PERSON]`.
- Returns normalized text string.

### `chunk_text(text, max_tokens)`

- Paragraph-aware splitting using `\n\n` boundaries first.
- Oversized paragraphs split on sentence boundaries (`. `).
- Remaining overage wraps at word boundaries.
- 10% token headroom on `max_tokens` = effective limit ~460 for default 512.
- Token count estimated via `len(text.split())` (simple whitespace).
- Returns `list[dict]` with `chunkIndex`, `text`, `tokenCount`.

## Data flow

```
OCR → Queue → Coref resolve → clusters + mentions + resolved_text
                                     ↓
                     extract_participants(clusters, mentions, resolved_text)
                                     ↓
                     participants list → POST /internal/documents/:id/participants
                                     ↓
                     normalize_text(resolved_text, participants, mentions)
                                     ↓
                     normalized text → chunk_text(normalized)
                                     ↓
                     chunks list → POST /internal/documents/:id/chunks
```

## Key design decisions

| Decision | Choice |
|---|---|
| Canonical name | Longest mention in cluster |
| Role matching | Iterate patterns.yaml in weight order; first match wins |
| Name normalization | Strip known prefixes + suffixes from titles.yaml |
| Relevance score | `mention_count / total_mentions * role_weight` |
| Entity type | `ner_hint` from matched pattern; fallback `null` |
| Token counting | `len(text.split())` — simple whitespace approximation |
| Chunk order | Paragraphs → sentences → word wrap |
| Chunk max_tokens | Configurable via `PARALEGAL_CHUNK_MAX_TOKENS` (default 512) |
| Chunk embedding | `[]` (empty) — actual embedding deferred |
| Extraction version | Hardcoded `1` for now |

## Chunks API note

`ChunkModel.body` requires `embedding: t.Array(t.Number())` (non-optional).
Send `embedding: []` for each chunk. Use `embeddingVersion: 0`,
`embeddingProvider: "none"`, `embeddingModel: "none"` as sentinel values.
