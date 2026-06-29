# Mini-Paralegal: Legal Case Similarity & Participant Ranking

## Overview

A subsystem of **The Eye** that transforms raw OCR'd legal documents into a structured, queryable knowledge graph of participants and case relationships. It answers two questions:

1. **Who matters in this case?** — Rank participants by relevance, extract their roles (judge, lawyer, police officer, etc.).
2. **What other cases are similar?** — Match cases by shared participants, legal substance, and metadata.

## Decisions (Design Tree)

All decisions below were made during the architecture grilling session. Each major section links back to the relevant decisions.

| # | Decision | Choice |
|---|---|---|
| 1 | What counts as a participant | All entities — typed (matched role) + untyped (`role: other`) |
| 2 | Pattern scope | Global (single shared set), not per-user |
| 3 | Re-process trigger | Manual per-document + batch API endpoint |
| 4 | Name storage | `name` (canonical) + `normalized_name` (aggressively stripped) |
| 5 | Title stripping | Stripped via matched role pattern prefix + suffix list from config |
| 6 | Config files | `patterns.yaml`, `titles.yaml`, `weights.yaml` |
| 7 | Embedding normalization | Role tokens for known entities, NER labels for untyped, leave non-entity legal text as-is |
| 8 | Cross-doc participant search | Character-offset lookup at query time (no extra storage) |
| 9 | Embedding for long docs | Bag-of-chunks (separate `document_chunks` table) |
| 10 | Chunk scoring | Weighted Mean-of-MAX — defaults by document type, overridable per query |
| 11 | Weight overrides | Config defaults (`weights.yaml`) + query-time URL params override |
| 12 | Schema dimensions | 3,072 (future-proof). Start with nomic-embed-text (768), upgrade later |
| 13 | Chunk boundaries | Paragraph-aware, sentence fallback, 10% token headroom |
| 14 | Tokenization | spaCy in Python worker (already loaded for coref) |
| 15 | Version tracking | YAML `version` field + file SHA256 hash for auto-detect |
| 16 | Pattern editing | YAML file now, hybrid with admin UI later |
| 17 | Independent POSTs | Participants and embedding POSTs fail independently. No atomicity requirement. |
| 18 | Re-process scope | Full job re-run (coref is deduped by textHash so near-free) |
| 19 | Version comparison | UI shows re-process button when `extraction_version < current` or `embedding_version < current` |

## Pipeline Architecture

```
Upload → Azure OCR → Store text → BullMQ Queue → Coref Worker (Python)
                                                        │
                                          ┌─────────────┼─────────────┐
                                          ▼             ▼             ▼
                                    Extract        Normalize      Generate
                                    participants   text for       embedding
                                    (role +        embedding      (bag of
                                     relevance)    (entity →      chunks)
                                                    role token)
                                          │             │             │
                                          ▼             ▼             ▼
                                    POST /internal   └──────┬──────┘
                                    /participants           │
                                                    POST /internal
                                                    /chunks (batch)
                                          │             │
                                          ▼             ▼
                                    participants    document_chunks
                                    table           table
                                          │             │
                                          └──────┬──────┘
                                                 ▼
                                            Similarity
                                            scoring
                                            (entity +
                                             embedding +
                                             metadata)
```

### Processing Order (single job, serial)

1. OCR text is stored (existing pipeline)
2. BullMQ enqueues a coreference-resolution job (existing)
3. Python worker picks up job, runs spaCy + neuralcoref (existing)
4. Worker **extracts participants** from coref clusters — every cluster becomes a participant row
5. Worker **normalizes text** for embedding — replaces entity mentions with role tokens where known, NER labels where untyped, leaves non-entity legal text intact
6. Worker **chunks** the normalized text — paragraph-aware, sentence fallback, 10% token headroom. Each chunk gets a position weight from `weights.yaml`
7. Worker **generates embeddings** per chunk via Ollama (dev) or OpenAI (prod)
8. Worker POSTs participants to API (independent — can succeed while embedding fails)
9. Worker POSTs chunk embeddings to API (independent — can be retried separately)
10. API stores participants in `participants` table, chunk embeddings in `document_chunks` table
11. Similarity queries run at read time using entity-overlap + bag-of-chunks Weighted Mean-of-MAX

## Participant Extraction

### Source Data

The coref worker produces `clusters` and `mentions` per document:

| Field | Type | Description |
|---|---|---|
| `clusters` | `List[List[str]]` | Groups of surface forms referring to the same entity |
| `mentions` | `List[{text, start, end, cluster_id}]` | Every mention with position |

Each cluster → one participant. **All clusters become participants** — even those that don't match a role pattern get `role: other` with a baseline relevance score.

### Canonical Name Selection

For each cluster, pick the canonical name (stored as `name`):
1. Longest non-pronoun mention (most descriptive)
2. OR first mention tagged as `PERSON` by spaCy NER
3. OR the most frequently occurring mention

### Name Normalization (cross-document matching)

Alongside `name`, store a `normalized_name` that is aggressively stripped for joins across documents:

```python
def normalize_name(canonical: str, matched_pattern: str) -> str:
    # 1. Strip the title prefix that the role pattern matched
    name = re.sub(matched_pattern, "", canonical).strip()
    # 2. Strip known legal suffixes (JSC, SC, CJ, JA, QC, SAN, etc.)
    for suffix in LEGAL_SUFFIXES:
        if name.endswith(f", {suffix}") or name.endswith(f" {suffix}"):
            name = name[:-(len(suffix) + 1)]
    # 3. Strip universal titles (from titles.yaml — Dr., Prof., CEO, CCO, etc.)
    for title in UNIVERSAL_TITLES:
        if name.lower().startswith(title.lower() + " ") or name.lower().startswith(title.lower() + "."):
            name = name[len(title) + 1:] if name[len(title)] == " " else name[len(title) + 2:]
    # 4. Strip initials (single uppercase letters with optional period)
    name = re.sub(r"\b[A-Z]\.?\s*", "", name).strip()
    # 5. Strip punctuation, lowercase, normalize whitespace
    return " ".join(name.lower().split())
```

This ensures "Justice Otieno" and "Hon. Lady Justice M. M. Otieno, JSC" both normalize to `otieno`.

### Role Detection

Roles are detected via configurable pattern matching defined in `patterns.yaml`. The system supports multi-jurisdiction patterns with weighted scoring.

Two separate config files:
- **`titles.yaml`** — universal title/honorific/professional-prefix list for stripping during normalization. These apply globally regardless of jurisdiction. Includes: Dr., Prof., Mr., Mrs., Ms., Sir, Hon., CEO, CFO, CTO, CCO, Director, Ambassador, etc.
- **`patterns.yaml`** — legal role patterns (jurisdiction-aware). These assign a role. Includes: judge, magistrate, lawyer, police_officer, prosecutor, plaintiff, defendant, witness, court, court_official, etc.

For "Dr.", "CEO", "CCO" etc. — they appear in `titles.yaml` for stripping, not in `patterns.yaml` for role assignment. If they simultaneously match a legal role pattern (e.g. "Dr. Otieno" matched by a judge pattern) the legal role wins. If they don't match any legal role pattern, the entity is stored with `role: other` and its mentions tracked for cross-document relation-finding.

### Relevance Scoring

```
relevance(entity) = w₁ · mention_freq_norm
                 + w₂ · position_weight
                 + w₃ · cluster_size_norm
                 + w₄ · role_weight
```

| Factor | Description |
|---|---|
| `mention_freq_norm` | Count of mentions ÷ max mentions across all entities in doc |
| `position_weight` | Boost of 1.2 if entity appears in first 10% or last 10% of text (key actors named in opening/closing) |
| `cluster_size_norm` | Number of distinct surface aliases ÷ max cluster size in doc |
| `role_weight` | From `patterns.yaml` (judge = 0.4, police = 0.3, witness = 0.2, etc.). `other` = 0.05 |

### Coref Cluster → Participant Mapping

```python
for cluster in coref_clusters:
    canonical = pick_canonical(cluster.mentions)
    ner_label = nlp(canonical)[0].ent_type_     # PERSON, ORG, GPE
    role, weight = match_role_patterns(canonical, ner_label)
    relevance = compute_relevance(cluster, doc_length)
    normalized = normalize_name(canonical, matched_pattern)

    participants.append({
        "name": canonical,               # best canonical form for display
        "normalized_name": normalized,    # aggressively cleaned for cross-doc joins
        "role": role,                    # from patterns.yaml, or "other"
        "role_confidence": confidence,    # 0.0–1.0 based on pattern match quality
        "entity_type": ner_label,        # PERSON, ORG, GPE from spaCy NER
        "mention_count": len(cluster.mentions),
        "mentions": [m.text for m in cluster.mentions],
        "cluster_id": cluster.i,
        "relevance_score": relevance,
    })
```

## Cross-Document Participant Search

When a user searches for a participant name (e.g. "Otieno"), we:

1. B-tree index lookup on `participants.normalized_name`
2. Return all documents containing that participant
3. For each mention, use the stored `start`/`end` character offsets (from the coref payload in `coreferenceResolvedContent`) to extract ±100 characters of surrounding context

No separate storage for sentence context — positions are already in the coref payload. Query-time extraction is fast enough at this scale.

## Config Files

Three YAML files live in `packages/coreference-worker/`:

### `patterns.yaml` — Legal Role Detection

```yaml
version: 4            # explicit version, bumped when patterns change
file_hash: abc123...  # auto-computed SHA256 at load time, changes when file does
roles:
  - role: judge
    jurisdictions: [all]
    patterns:
      - "^(Judge|Hon\\.?|Justice|Magistrate)\\s+"
      - "(Chief Justice|Presiding Judge|Circuit Judge)"
    weight: 0.4
    ner_hint: PERSON
```

### `titles.yaml` — Universal Title Stripping

```yaml
version: 1
titles:
  - "Dr"
  - "Prof"
  - "Mr"
  - "Mrs"
  - "Ms"
  - "Miss"
  - "Sir"
  - "Rt"
  - "Hon"
  - "CEO"
  - "CFO"
  - "CTO"
  - "CCO"
  - "Director"
  - "Ambassador"
  - "Bishop"
  - "Sheikh"
  - "Rev"
  - "Fr"
  - "Sr"
  - "St"

suffixes:
  - "JSC"
  - "SC"
  - "CJ"
  - "JA"
  - "AG"
  - "SAG"
  - "QC"
  - "SAN"
  - "SC"
  - "CJ"
  - "VP"
  - "MP"
```

### `weights.yaml` — Chunk Position Weights

```yaml
version: 1
default:
  chunk_0: 1.0
  chunk_1: 0.85
  chunk_2: 0.7
  chunk_3: 0.6
  chunk_4+: 0.5

per_document_type:
  judgment:
    chunk_0: 1.0
    chunk_1: 0.85
    chunk_2: 0.6
    chunk_3: 0.5
    chunk_4+: 0.4
  contract:
    chunk_0: 1.0
    chunk_1: 0.9
    chunk_2: 0.85
    chunk_3: 0.8
    chunk_4+: 0.7
  police_report:
    chunk_0: 1.0
    chunk_1: 0.8
    chunk_2: 0.6
    chunk_3: 0.5
    chunk_4+: 0.4
```

### Version Tracking

Each YAML file carries:
- **`version`** (integer) — bumped manually by the user when editing
- **`file_hash`** (SHA256) — computed automatically at worker startup

The worker loads the file, computes its hash, and compares against stored hash. If the hash differs from what's stored but the version is the same, the worker logs a warning ("patterns.yaml modified but version not bumped — assuming change"). The UI then shows the re-process button because the effective version differs.

The worker reports `extraction_version` and `embedding_version` in the POST body. The API stores these on the document. The re-process button shows when `doc.extraction_version < current_patterns_version` OR `doc.embedding_version < current_embedding_version`.

## Entity-Normalized Embeddings

### Why Entity Normalization

Raw text embeddings conflate legal substance with incidental names — "John Kamau vs. Sarah Wanjiku" and "Peter Ochieng vs. Mary Atieno" look different even when they're both breach of contract cases. Entity normalization strips what's incidental and keeps what's substance.

### Normalization Strategy

Before embedding, replace named entities with role tokens:

```
Raw:    "Justice Otieno found that John Kamau breached the contract with ABC Ltd..."
Normal: "[JUDGE] found that [PLAINTIFF] breached the contract with [ORG]..."
```

| spaCy NER label / participant role | Replacement token |
|---|---|
| `judge` | `[JUDGE]` |
| `magistrate` | `[MAGISTRATE]` |
| `lawyer` | `[LAWYER]` |
| `police_officer` | `[POLICE]` |
| `prosecutor` | `[PROSECUTOR]` |
| `plaintiff` | `[PLAINTIFF]` |
| `defendant` | `[DEFENDANT]` |
| `witness` | `[WITNESS]` |
| `court` | `[COURT]` |
| `court_official` | `[COURT_OFFICIAL]` |
| `other` (PERSON via NER) | `[PERSON]` |
| `other` (ORG via NER) | `[ORG]` |
| `other` (GPE via NER) | `[LOCATION]` |
| `DATE` (NER only) | `[DATE]` |
| `MONEY` (NER only) | `[AMOUNT]` |
| `LAW` (NER only) | `[STATUTE]` |

**Non-entity legal text is left as-is.** Phrases like "the plaintiff", "the court", "the accused", "breach of contract" are legal substance and carry meaning about case structure. They are not replaced.

### Chunking Strategy

Documents are chunked only when they exceed the embedding model's token limit:

1. **Tokenize** the entity-normalized text using spaCy tokenizer (already loaded)
2. **If total ≤ model_limit - 10% headroom** → one chunk, done
3. **Otherwise**, walk paragraph by paragraph through the text:
   - Accumulate paragraphs into the current chunk
   - If adding the next paragraph would exceed the limit → finalize current chunk, start new one
4. **If a single paragraph exceeds the limit** on its own → split that paragraph by sentence
5. **If a single sentence still exceeds the limit** (rare) → hard-split at token boundary

Each chunk stores its `chunk_index` and gets a position weight from `weights.yaml` based on its index and the document type.

### Embedding Models

| Environment | Provider | Model | Context | Dimensions |
|---|---|---|---|---|
| Development (default) | Ollama (local) | `nomic-embed-text` | 8,192 | 768 |
| Production | OpenAI | `text-embedding-3-small` | 8,191 | 1,536 |
| Future | Local (GPU) | `gte-Qwen2-7B-instruct` | 32,768 | 3,584 |
| Future (legal-specific) | API | `voyage-law-2` | 16,000 | 1,024 |

**Schema is designed for 3,072 dimensions** (largest common model across options). pgvector handles any dimension — storing 768 in a 3,072-dim column wastes only padding bytes. This lets us swap models without migration. Start with `nomic-embed-text` (free, works offline), upgrade by flipping `EMBED_PROVIDER` and re-processing.

### Bag-of-Chunks Similarity

Document A (N chunks) vs Document B (M chunks):

```
score(A, B) = Σ(w_i · max_cosine(A_i, B)) / Σ(w_i)
      for each chunk i in A
```

Where `max_cosine(A_i, B)` = max cosine similarity between chunk A_i and all chunks of B.

- Favors documents where *multiple* chunks find good matches
- A partial match (one chunk matches well, others don't) gets a moderate score
- A full match (all chunks match well) gets a high score

The user can override chunk weights per query via URL params:
```
GET /cases/:id/similar?chunk_weights=1.0,0.9,0.8
```

## Schema

### New Tables

```sql
-- Enable pgvector extension
CREATE EXTENSION vector;

-- Participants: one row per entity per document
CREATE TABLE participants (
    id              SERIAL PRIMARY KEY,
    document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,               -- best canonical form (for display)
    normalized_name TEXT NOT NULL,               -- aggressively stripped (for joins)
    role            TEXT NOT NULL DEFAULT 'other',
    role_confidence REAL DEFAULT 0.0,
    entity_type     TEXT,                         -- PERSON, ORG, GPE from spaCy NER
    mention_count   INTEGER DEFAULT 0,
    mentions        TEXT[] DEFAULT '{}',          -- all surface forms from coref clusters
    cluster_id      INTEGER,                      -- index into coref clusters array
    relevance_score REAL DEFAULT 0.0,
    extraction_version INTEGER DEFAULT 1          -- which patterns.yaml version extracted this

    -- Extensibility: future columns for LLM-refined role, citation count, etc.
);

CREATE INDEX idx_participants_document_id ON participants(document_id);
CREATE INDEX idx_participants_normalized_name ON participants(normalized_name);
CREATE INDEX idx_participants_role ON participants(role);
CREATE INDEX idx_participants_doc_role ON participants(document_id, role);

-- Document chunks: one row per chunk per document
CREATE TABLE document_chunks (
    id              SERIAL PRIMARY KEY,
    document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,             -- 0-based position in document
    embedding       vector(3072),                 -- sized for largest model
    embedding_provider TEXT,                       -- 'ollama' or 'openai'
    embedding_model TEXT,                         -- 'nomic-embed-text', 'text-embedding-3-small'
    chunk_text_hash TEXT,                         -- SHA256 of the chunk's text (for dedup)
    token_count     INTEGER,                      -- actual tokens in this chunk
    created_at      TIMESTAMP DEFAULT NOW(),

    UNIQUE(document_id, chunk_index)
);

CREATE INDEX idx_chunks_document_id ON document_chunks(document_id);
CREATE INDEX idx_chunks_embedding ON document_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
```

### Modified Tables

```sql
ALTER TABLE documents ADD COLUMN extraction_version INTEGER DEFAULT 1;
ALTER TABLE documents ADD COLUMN embedding_version INTEGER DEFAULT 1;
ALTER TABLE documents ADD COLUMN embedding_provider TEXT;
ALTER TABLE documents ADD COLUMN embedding_model TEXT;
```

### Existing Schema (unchanged but relevant)

- `documents.parties` (jsonb) — remains as a denormalized cache/summary. The `participants` table is the source of truth.
- `documents.coreferenceResolvedContent` (jsonb) — continues to store the full coref payload including `resolved_text`, `clusters`, `mentions`. Mention `start`/`end` offsets used for cross-document participant context retrieval.
- `documents.textHash` — used for coref dedup. If text is unchanged, a re-process skips coref and re-runs only extraction + embedding.

## Similarity Scoring

### Entity Overlap (Weighted Jaccard)

Two cases are similar when they share participants. Each participant role carries a weight.

```sql
WITH target_participants AS (
    SELECT normalized_name, role
    FROM participants
    WHERE document_id = :target_id
)
SELECT
    d.id,
    d.case_number,
    d.document_type,
    SUM(
        CASE p2.role
            WHEN 'judge' THEN 0.4
            WHEN 'magistrate' THEN 0.35
            WHEN 'lawyer' THEN 0.3
            WHEN 'defendant' THEN 0.3
            WHEN 'prosecutor' THEN 0.25
            WHEN 'police_officer' THEN 0.2
            WHEN 'witness' THEN 0.1
            WHEN 'court' THEN 0.15
            WHEN 'court_official' THEN 0.2
            ELSE 0.05
        END
    ) / NULLIF(
        (SELECT COUNT(*) FROM target_participants) +
        (SELECT COUNT(*) FROM participants WHERE document_id = d.id) -
        matched.count,
        0
    ) AS entity_similarity
FROM target_participants t
JOIN participants p2 ON t.normalized_name = p2.normalized_name
    AND p2.document_id != :target_id
JOIN documents d ON d.id = p2.document_id
GROUP BY d.id, matched.count
ORDER BY entity_similarity DESC
LIMIT 20
```

### Embedding Cosine via Document Chunks

For the target document, query all its chunks against all chunks of other documents:

```sql
-- Find documents whose chunks are most similar to any chunk of the target
SELECT
    dc.document_id,
    d.case_number,
    d.document_type,
    1 - (dc.embedding <=> :query_chunk_embedding) AS cosine_similarity
FROM document_chunks dc
JOIN documents d ON d.id = dc.document_id
WHERE dc.document_id != :target_id
  AND dc.embedding_provider = :provider
ORDER BY dc.embedding <=> :query_chunk_embedding
LIMIT 50
```

**Weighted Mean-of-MAX aggregation** happens in the application layer:

```python
def score_bag_of_chunks(target_chunks, candidate_chunks, doc_type):
    weights = get_weights(doc_type)  # from weights.yaml
    
    chunk_scores = []
    for tc in target_chunks:
        best = max(cosine_sim(tc.embedding, cc.embedding) for cc in candidate_chunks)
        w = weights.get(f"chunk_{tc.chunk_index}", weights["default"])
        chunk_scores.append((best, w))
    
    weighted_sum = sum(score * w for score, w in chunk_scores)
    total_weight = sum(w for _, w in chunk_scores)
    return weighted_sum / total_weight if total_weight > 0 else 0
```

### Composite Score (Application Layer)

```typescript
interface SimilarCaseResult {
  caseId: number
  caseNumber: string
  documentType: string
  score: number          // composite
  breakdown: {
    entityOverlap: number
    embeddingCos: number | null
    metadataScore: number  // future: document type, court, year
  }
  reasons: string[]      // human-readable: "Shares Judge Otieno", "Same court (High Court)"
}
```

Composite formula:

```
score = α · entity_overlap + β · bag_of_chunks + γ · metadata
```

Default α = 0.4, β = 0.4, γ = 0.2. Configurable per query via URL params so users can prioritise "similar participants" vs "similar legal substance".

## Re-Processing

### Version Lifecycle

1. User edits `patterns.yaml` → bumps `version` field → the SHA256 hash changes
2. Worker loads file at startup, notes `version` + `hash`
3. On next POST, worker sends `extraction_version` in payload
4. API compares against `documents.extraction_version`
5. **UI shows "Re-analyze" button** on document detail when `doc.extraction_version < current_version`
6. Clicking it enqueues a fresh BullMQ job for that document ID
7. Worker re-runs full job: coref (deduped by textHash if text unchanged) → extraction → embedding → POST

### Re-process API

```http
POST /internal/documents/reprocess
Content-Type: application/json

{
  "documentIds": [42, 43, 44],
  "steps": ["participants", "embedding"]   // or omit for all
}
```

### Independent Failure Handling

Participants and embeddings are POSTed independently:
- If `POST /internal/documents/:id/participants` fails → document has no participants. Button shows "Re-analyze".
- If `POST /internal/documents/:id/embedding` fails → document has participants but no vectors. Entity-overlap similarity still works. Button shows "Re-analyze (embedding pending)".
- Re-process always runs the full job — coref dedup makes it efficient.

## API Endpoints

### Internal (Worker-Facing)

| Method | Path | Description |
|---|---|---|
| POST | `/internal/documents/:id/participants` | Upsert participants extracted by coref worker |
| POST | `/internal/documents/:id/chunks` | Batch upsert chunk embeddings |
| POST | `/internal/documents/reprocess` | Enqueue re-processing for document ID(s) |

`POST /internal/documents/:id/participants` body:
```json
{
  "participants": [
    {
      "name": "Justice Otieno",
      "normalized_name": "otieno",
      "role": "judge",
      "role_confidence": 0.95,
      "entity_type": "PERSON",
      "mention_count": 47,
      "mentions": ["Justice Otieno", "the Honourable Judge", "His Lordship", "Otieno"],
      "cluster_id": 0,
      "relevance_score": 0.91
    }
  ],
  "extraction_version": 4
}
```

`POST /internal/documents/:id/chunks` body:
```json
{
  "chunks": [
    {
      "chunk_index": 0,
      "embedding": [0.012, -0.034, ...],
      "provider": "ollama",
      "model": "nomic-embed-text",
      "chunk_text_hash": "sha256...",
      "token_count": 2048
    },
    {
      "chunk_index": 1,
      "embedding": [...],
      "provider": "ollama",
      "model": "nomic-embed-text",
      "chunk_text_hash": "sha256...",
      "token_count": 1800
    }
  ],
  "embedding_version": 1
}
```

### Public / Frontend-Facing

| Method | Path | Description |
|---|---|---|
| GET | `/cases/:id/similar?limit=10&a=0.4&b=0.4&c=0.2&chunk_weights=1.0,0.9,0.8` | Similar cases ranked by composite score |
| GET | `/participants?name=Otieno&role=judge` | Find participant across all cases with mention context |
| GET | `/cases/:id/participants` | Participants for a case, sorted by relevance_score |
| GET | `/cases/:id/participants/:participant_id/context` | Surrounding text context for a participant's mentions |
| GET | `/cases/:id/graph` | Nodes + edges for network visualization |

`GET /cases/:id/similar` response:
```json
{
  "caseId": 42,
  "caseNumber": "2024/KECA/123",
  "similarCases": [
    {
      "caseId": 37,
      "caseNumber": "2024/KECA/98",
      "documentType": "judgment",
      "score": 0.78,
      "breakdown": {
        "entityOverlap": 0.82,
        "embeddingCos": 0.74,
        "metadataScore": 0.65
      },
      "reasons": [
        "Shares Judge Otieno",
        "Same court: Court of Appeal",
        "Same document type: judgment"
      ],
      "sharedParticipants": [
        { "name": "Justice Otieno", "role": "judge" },
        { "name": "ODPP", "role": "prosecutor" }
      ]
    }
  ]
}
```

`GET /participants?name=otieno` response:
```json
{
  "participant": {
    "normalized_name": "otieno",
    "canonical_name": "Justice Otieno",
    "role": "judge",
    "cases": [
      {
        "documentId": 42,
        "caseNumber": "2024/KECA/123",
        "relevanceScore": 0.91,
        "mentions": 47,
        "context_snippet": "...submitted that [Justice Otieno] in his ruling..."
      }
    ]
  }
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `EMBED_PROVIDER` | `ollama` | `ollama` for local dev, `openai` for production |
| `OLLAMA_BASE_URL` | `http://ollama:11434` | Ollama server URL (Docker service name) |
| `OPENAI_API_KEY` | — | OpenAI API key for production |
| `OPENAI_EMBED_MODEL` | `text-embedding-3-small` | OpenAI embedding model ID |
| `JURISDICTION` | auto-detect | Override: `ke`, `us`, `uk`, `ng`, `in`, `za`, `ca` |
| `COREF_SERVICE_TOKEN` | — | Auth token for worker→API calls |
| `PATTERNS_PATH` | `patterns.yaml` | Path to role detection patterns file |
| `TITLES_PATH` | `titles.yaml` | Path to universal titles file |
| `WEIGHTS_PATH` | `weights.yaml` | Path to chunk position weights file |
| `EMBED_MAX_TOKENS` | 7372 | Max tokens per chunk (model limit minus 10% headroom) |

### Docker Compose

Add to `docker-compose.dev.yml`:

```yaml
ollama:
  image: ollama/ollama:latest
  ports:
    - "11434:11434"
  volumes:
    - ollama_data:/root/.ollama
  networks:
    - the-eye-network
  command: serve

volumes:
  ollama_data:
```

Uncomment and update the `coreference-worker` service to include:

```yaml
environment:
  - EMBED_PROVIDER=ollama
  - OLLAMA_BASE_URL=http://ollama:11434
  - JURISDICTION=ke
  - PATTERNS_PATH=patterns.yaml
  - TITLES_PATH=titles.yaml
  - WEIGHTS_PATH=weights.yaml
```

### Jurisdiction Auto-Detect

If the `JURISDICTION` env var is not set, the worker sniffs jurisdiction from the first 5000 characters of the resolved text:

| Signal words | Jurisdiction code |
|---|---|
| "High Court of Kenya", "eKLR", "ODPP" | `ke` |
| "EWCA", "UKSC", "EWHC", "Crown Court" | `uk` |
| "F.3d", "U.S.", "S. Ct.", "Circuit" | `us` |
| "INSC", "Delhi High Court", "Crl.A." | `in` |
| "ZACC", "SCA", "Gauteng" | `za` |
| "FCA", "SCC", "ONCA" | `ca` |

Override explicitly with `JURISDICTION=ke`.

### Jurisdiction Pattern Matrix (Illustrative)

| Role | Kenya (`ke`) | UK (`uk`) | US (`us`) | Nigeria (`ng`) |
|---|---|---|---|---|
| judge | Judge, Justice, Magistrate | Lord/Lady Justice, Master | Circuit Judge, District Judge, J. | Justice, CA |
| lawyer | Advocate, M/s | Barrister, Solicitor, QC | Attorney, Esq., LLP | SAN, & Co. |
| police | IP, OCS, PC, DCI | PC, WPC, Inspector | Officer, Deputy, Detective | ASP, SP, CSP |
| prosecutor | ODPP, State Counsel | CPS, Crown Prosecutor | DA, ADA, US Attorney | DPP, AGF |

## Extensibility Points

### Adding New Roles or Jurisdictions

Edit `patterns.yaml` — add a new role block or add a jurisdiction to an existing block. No Python code changes.

```yaml
- role: mediator
  jurisdictions: [all]
  patterns:
    - "(Mediator|Arbitrator|Panel Chair)"
  weight: 0.25
  ner_hint: PERSON
```

Bump `version` in `patterns.yaml`. The UI will show re-process buttons on all documents processed with the old version.

### Adding New Universal Titles

Edit `titles.yaml` — add to the `titles` list. No code change. Title stripping runs at extraction time, so existing documents need re-processing to pick up new titles in their `normalized_name`.

### Adding Structured Summary Sections (Future)

When LLM summarization is added:

```python
# Worker step after coref
summary = llm.generate_sections(resolved_text)  # {facts, issues, holding, reasoning}
post_summary(document_id, summary)
```

Add new chunk groups:

```sql
ALTER TABLE document_chunks ADD COLUMN section TEXT;  -- 'facts', 'issues', 'holding', 'reasoning', 'full'
```

Similarity query weights sections independently — issues match matters more than facts match.

### Swapping Embedding Models

| Change | What to update |
|---|---|
| Model (e.g. nomic → all-MiniLM) | `EMBED_MODEL` env var |
| Provider (ollama → openai) | `EMBED_PROVIDER` env var + API key |
| Dimensions change | No schema change — table defined at 3072, unused dimensions pad |
| Local model not in Ollama | Run `sentence-transformers` directly in Python worker |

After swapping, bump `embedding_version` in the environment. Re-process documents to regenerate chunk embeddings.

### Adding a Citation Graph (Future)

New table:

```sql
CREATE TABLE case_citations (
    citing_document_id   INTEGER REFERENCES documents(id),
    cited_document_id    INTEGER REFERENCES documents(id),
    confidence           REAL       -- how sure we are this is a real citation
);
```

Similarity scoring adds a citation overlap factor γ to the composite.

### Adding User Feedback (Future)

```sql
CREATE TABLE similarity_feedback (
    user_id        TEXT,
    case_a_id      INTEGER REFERENCES documents(id),
    case_b_id      INTEGER REFERENCES documents(id),
    is_similar     BOOLEAN,      -- thumbs up / thumbs down
    created_at     TIMESTAMP DEFAULT NOW()
);
```

Adjust α/β/γ weights per user or globally based on aggregate feedback.

### pgvector Index Evolution

| Document count | Recommended index |
|---|---|
| < 1K | No index (sequential scan is fast enough) |
| 1K – 100K | `ivfflat` with `lists = sqrt(n)` |
| 100K+ | `hnsw` with `m = 16, ef_construction = 200` |

Swap without rebuilding the app:
```sql
DROP INDEX idx_chunks_embedding;
CREATE INDEX idx_chunks_embedding ON document_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);
```

### Pattern Editing UI (Future)

A `/admin/patterns` page in the web app:
- Table: `role_patterns (id, role, jurisdiction, pattern, weight, ner_hint)`
- Worker loads patterns from API at startup
- Auto-increments version on save
- Shows dirty-document count: "2,140 documents need re-processing"
- YAML remains the deployable default (`patterns.yaml`). Admin UI writes to a `user_patterns` table. Worker merges both at load time.

## Development Roadmap

| Phase | What | Depends on |
|---|---|---|
| **0** | Schema migration (participants, document_chunks, version columns, indexes) | — |
| **1** | Create config files: `patterns.yaml`, `titles.yaml`, `weights.yaml` | — |
| **2** | Python worker: participant extraction + text normalization + chunking + embedding → POST to API | Phase 0, 1 |
| **3** | API: internal endpoints (participants, chunks, reprocess) + public endpoints (similar, participants search) | Phase 2 |
| **4** | Docker Compose: uncomment worker, add Ollama service | Phase 2 |
| **5** | Web UI: case detail with participants ranking + similar cases panel + re-process button | Phase 3 |
| **6** | Embedding cosine in similarity (bag-of-chunks Weighted Mean-of-MAX) | Phase 2 + 3 |
| **7** | Network graph visualization (`/cases/:id/graph`) | Phase 3 |
| **8** | Metadata scoring + composite tuning | Phase 6 |
