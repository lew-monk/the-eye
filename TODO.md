# Cross-Document Intelligence

## Phase 0: Entity Weight Recalibration (Foundation)

> On extraction, detect entities that appear across multiple documents in the same case, then recalibrate relevance scores based on cross-document presence. This is the foundational layer — all subsequent phases depend on accurate entity weights.

### Backend

- [x] **`ParticipantRepository.findCaseEntityOverlap()`** — Given `documentId` and `caseId`, find which normalized entity names from this document also appear in other documents of the same case. Returns `{ participantId, normalizedName, docCount, totalDocsInCase, mentionCountAcrossCase }[]`.
- [x] **`ParticipantsService.store()` recalibration hook** — After storing participants for a document, if the document has a `caseId`:
  - Compute case-wide entity overlap
  - **Bonus formula** (preserves extraction scores, 0-1 scale): `baseScore + ((docCount - 1) / totalDocsInCase) * 0.5`, capped at 1.0. Single-doc entities keep original score; multi-doc entities get up to +0.5 bonus.
  - **Bidirectional**: also recalibrates the same entities in other documents of the case (their `docCount` just increased).
  - Persist updated scores on all affected participants.
  - Adds `findByCaseIdAndNormalizedNames()` to `ParticipantRepository` for the bidirectional lookup.
  - Logs `participants_recalibrated` with `bidiUpdates` count.

### Frontend (zero changes needed)

- `WeightBar` already reads `relevanceScore`, `ParticipantRow` already shows `documentCount`. Recalibrated weights flow through automatically.

---

## Phase 1: Already Half-Built (low effort, high impact)

- [x] **Wire up similar cases** — `ChunksService.getSimilar()` and endpoint `GET /cases/:id/similar` already exist. Added tRPC procedure `cases.getSimilarCases` + "Similar Cases" panel on case detail page via `GET /cases/:id/similar-cases`. Resolves document IDs to actual case IDs with deduplication.
- [x] **Global entity search** — `participantRepository.search()` already does fuzzy search across all participants with case join. Added tRPC procedure `cases.entitySearch` + `EntitySearchDialog` accessible from app shell header. Also added `caseId` to `ParticipantWithCase` for proper case linking.
- [x] **Auto-populate case relations** — During entity recalibration, if two cases share the same normalized entity, auto-inserts into `case_relations` table with `relationType: 'shared_entity'`. Added `GET /cases/:id/relations` endpoint, tRPC procedure `cases.getCaseRelations`, and "Connected Cases" panel on case detail page.

---

## Phase 2: Entity Dossier / Profile

- [x] **Entity dossier endpoint** — `GET /entities/:normalizedName/dossier`:
  - All mentions with context snippets across all documents (generalize `getMentionContexts`)
  - Role distribution (witness vs defendant vs mixed)
  - Co-occurring entities (who appears alongside this entity?)
  - Cases and documents where the entity appears
  - Synthesized narrative profile (concatenated context windows)
- [x] **Entity detail page** — New route `/entities/$entityName` with dossier data, role breakdown, related entities, and cross-case links.
- [x] **Entity confidence from cross-document consensus** — If "Jane Smith" appears as `witness` in 3 docs and `defendant` in 1, flag the outlier. If extracted in 4 out of 5 docs in a case, boost confidence. Display confidence badge in `ParticipantRow`. Case entities aggregated by `normalizedName` via `CasesService.getCaseEntities` + `GET /cases/:id/entities`.

---

## Phase 3: Document Relationships

- [x] **Within-case document graph** — Detect explicit cross-references in coref-resolved text ("as stated in document X") and implicit subset relationships. Mini-graph display: "Judgment → references → Affidavit → references → Police Report". `GET /cases/:id/graph` + case detail panel.
- [x] **Document chronology** — Extract dates from `documents.structuredData` (jsonb). Timeline view within a case. Plot entity appearances on the timeline. `GET /cases/:id/chronology` + case detail panel.

---

## Phase 4: Intelligence Layer

- [x] **Entity co-occurrence analytics** — Pairwise co-occurrence counts across documents. Feed the `ENTITY_NETWORK` panel on the dashboard via `GET /entities/network`.
- [x] **Role consistency flagging** — Cross-document role variance detection. Flag entities whose role changes across documents as an intelligence signal. `GET /cases/:id/role-flags` + case detail panel.
- [x] **Entity mention trajectory** — Plot mention frequency across documents in chronological order. Show entity surge/drop-off as narrative arc insight within a case. `GET /cases/:id/trajectories` + case detail panel.

---

## Data Dependencies

| Feature | Uses Existing | New Schema Needed |
|---|---|---|
| Entity weight recalibration | `participants.normalizedName`, `relevanceScore`, `documents.caseId` | None |
| Similar cases wiring | `ChunksService.getSimilar()` | None |
| Global entity search | `participantRepository.search()` | None |
| Auto case relations | `case_relations` table | None |
| Entity dossier | `participants`, `coreference_*`, `documents` | None |
| Entity confidence | `participants.normalizedName`, `role` | None |
| Document graph | Coref text, chunk data | None |
| Document chronology | `documents.structuredData` | None |
| Entity co-occurrence | `participants` table | None (aggregation query) |
| Role consistency | `participants.normalizedName`, `role` | None |
| Mention trajectory | `participants.mentionCount` | None |
