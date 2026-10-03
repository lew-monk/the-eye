# Plan: Case-file ingestion engine (`packages/ingestion` + API module)

> Note: the background PDF download job is still running (was at ~305MB/469 files
> when last checked). Stop it before building (`pkill -f dl_vic_pdfs.py`);
> what it fetched becomes seed data for `~/Downloads/vic-judgments-demo/`.

## 1. Goal & scope

- Recursive upload from a **location** (local dir, S3 prefix, later GDrive folder)
  with **progress monitoring** (polling + SSE) and **retries**.
- Abstract ports/adapters: v1 implements **LocalFs + S3**,
  **GDrive as a typed stub**.
- Judgments: **own table** (`judgment_documents` + `judgment_chunks`),
  **own folder** in object storage (`judgments/...`), **own BullMQ queue**
  (`judgments`), OCR via existing pipeline semantics, then **embed + summarize
  with a cheap LLM**.
- Backend only (no web-app UI in this slice). Everything on **bun**.

## 2. Architecture (ports & adapters)

**New package `packages/ingestion`** — pure engine, no Elysia/HTTP imports
(keeps it testable, narrow seam). **API module
`apps/api/src/modules/ingestion/`** — thin handlers per repo convention
(`index.ts` routes → `service.ts` → engine; `model.ts` validation).

```text
packages/ingestion/src/
  ports/source-connector.ts   # SourceConnector interface + SourceFile/Handle types
  ports/object-sink.ts        # narrow put-with-progress interface over ObjectStorage
  ports/job-store.ts          # persistence seam (drizzle impl injected)
  connectors/local-fs.ts      # recursive walk via Bun.Glob `**/*`, stat/size/mtime
  connectors/s3.ts            # ListObjectsV2 pagination (flat listing already recursive) + GetObject stream
  connectors/gdrive.ts        # typed stub: implements port, throws NotImplemented (fake in tests)
  connectors/registry.ts      # source-kind → factory (pure map, no conditionals sprawl)
  walk/filters.ts             # extension/size/ignore-pattern predicates (pure)
  walk/walker.ts              # AsyncGenerator discovery, bounded concurrency
  transfer/policy.ts          # retry/backoff+jitter math (pure, deterministic via injected clock/rng)
  transfer/uploader.ts        # chunked copy → sink with progress callbacks + resume-by-checksum
  jobs/types.ts               # Job/File/Status/Event branded types, no any/unknown
  jobs/orchestrator.ts        # state machine: discovered→staged→uploaded→ocr→embedded→summarized/failed
  jobs/store-drizzle.ts       # JobStore impl (only file touching drizzle)
  progress/hub.ts             # typed in-memory event hub (SSE source; swappable)
  pipeline/judgment-queue.ts  # BullMQ 'judgments' queue defs (ingest-file, meta ops)
  pipeline/meta.ts            # embed (reuse core provider factory) + cheap-LLM summary
  index.ts                    # public API: createJob, getStatus, listFiles, streamEvents
```

**DB (in `@workspace/shared`, migration via existing drizzle setup):**

- `judgment_documents(id, source, source_key, relative_path, filename, size_bytes,
  checksum, storage_key, status, attempts, last_error, bytes_transferred,
  ocr_text?, summary?, case_id?, timestamps)` — checksum unique for idempotent
  resume; `relative_path` preserves the file's position inside nested folders
  (see §2.1).
- `judgment_chunks(judgment_id FK CASCADE, chunk_index, text, embedding vector,
  model, text_hash)` mirroring `document_chunks` conventions.

**Storage layout:** hierarchy-preserving —
`judgments/<source>/<jobId>/<relative/dir>/<basename>-<shortchecksum>.<ext>`
via a `buildJudgmentStorageKey()` next to existing
`buildDocumentStorageKey`. The `<relative/dir>` mirrors the nested folder
structure under the job root; the checksum suffix disambiguates same-named
files in different folders and makes keys content-stable for resume.

### 2.1 Nested-folder semantics (explicit)

- **Recursion is the default**, not an option: local walk uses `**/*` globbing,
  S3 prefix listing is inherently recursive, GDrive port requires recursive
  traversal in its contract suite. Non-recursive ("top-level only") is a
  `walk/filters.ts` predicate for later, not v1.
- **Every discovered file carries `relativePath`** (POSIX-normalized path of
  the file relative to the job root). Connectors produce it: local strips the
  root prefix, S3 strips the prefix, GDrive joins parent-folder names.
- **Hierarchy is preserved end-to-end:** `relativePath` is stored on the
  `judgment_documents` row and mirrored in the storage key, so
  `cases/2024/smith/pleading.pdf` stays findable as such. Progress reporting
  aggregates per file and rolls up per folder and per job.
- **Safety rules (in `walk/filters.ts` + connector, all unit-tested):**
  directory symlinks are **not followed** (recorded and skipped, avoids cycles);
  `relativePath` is rejected if it escapes the root (`..`, absolute paths);
  configurable max depth (default 32) aborts with a typed error instead of
  recursing forever; empty directories are counted on the job but create no rows.
- **Contract suite covers nesting:** a shared fixture tree (nested dirs,
  same basename in two folders, symlink loop, empty dir, deep chain) runs
  against all three connectors, asserting identical `relativePath` sets —
  so S3/GDrive behave exactly like local disk.

**API routes** (`POST /ingestion/jobs`, `GET /ingestion/jobs`,
`GET /ingestion/jobs/:id`, `GET /ingestion/jobs/:id/files`,
`GET /ingestion/jobs/:id/events` SSE), reusing `requirePermission` pattern.
Note: `POST /upload` currently has auth commented out — the new module ships
with `requirePermission({service:'api',resource:'documents',actions:['create']})`
**enabled** from day one.

**Cheap LLM for summaries:** configurable provider defaulting to the cheapest
configured (`gpt-4o-mini` or Ollama per `resolveEmbeddingProviderName`
precedent); exact model pinned in build after checking
`workers/embedding/factory.ts` + env.

## 3. Quality-gate toolchain (one documented analyzer each)

Documented in `packages/ingestion/QUALITY-GATES.md`.

| Gate | Analyzer / enforcement |
|---|---|
| Cyclomatic < 22 / fn | ESLint `complexity: ["error", 21]` |
| Cognitive < 22 / fn | `eslint-plugin-sonarjs` `cognitive-complexity: ["error", 21]` |
| Halstead difficulty < 80 / fn+module | `typhonjs-escomplex` per-function/module report + CI threshold script |
| < 500 lines / file | ESLint `max-lines: ["error", 499]` (prod + test; split fakes/fixtures out) |
| 100% stmt/branch/fn/line | `bun test --coverage` + CI script failing below 100% on in-scope files |
| CRAP < 25 | small script: CRAP = c²·(1−cov)³ + c from escomplex complexity + coverage JSON |
| Zero surviving mutants | Stryker with **command runner** invoking `bun test` (full-suite-per-mutant; OK at this package size, nightly in CI) |
| No dead code | `knip` + `noUnusedLocals`/`noUnusedParameters` |
| No `any`/`unknown` anywhere | `tsc --strict` (repo already strict) + `@typescript-eslint/no-explicit-any: error` + `no-restricted-syntax` ban on `TSUnknownKeyword`; typed fakes, `JsonValue` unions from `api/lib/json.ts` pattern |

Complexity strategy: deep typed modules + narrow ports (above); orchestrator
delegates to pure seams (`policy.ts`, `filters.ts`, state transitions as total
functions) so each function stays small and every branch is unit-testable.

## 4. Test strategy (TDD, red-green-refactor)

- **Pure units:** backoff math (injected fake clock), filters, storage-key
  builder, state-machine transitions — table-driven, 100% branch incl. error arms.
- **Port contract suite:** one suite run against LocalFs (tmpdir fixture), S3
  (existing MinIO via `S3_ENDPOINT` from docker-compose), and GDrive fake —
  guarantees substitutability. Uses the shared nested-tree fixture (§2.1):
  identical `relativePath` sets across all connectors.
- **Transfer:** progress-callback sequence assertions, retry exhaustion →
  quarantine, checksum-resume skips completed rows.
- **Integration:** API module tests with injected fake connectors + real drizzle
  (test DB) + BullMQ (test redis); SSE event ordering.
- **Judgment pipeline:** OCR reuse asserted via existing `getOCRService` seam;
  embed + summary asserted with stubbed cheap-model client (recorded prompts,
  no network).

## 5. Build phases

1. **Scaffold + gates first:** `packages/ingestion` (bun, tsconfig strictest,
   eslint + sonarjs + max-lines, escomplex/CRAP scripts, Stryker config, knip,
   coverage gate) with one failing-then-passing vertical slice (local walk →
   job row) to prove the toolchain.
2. **Ports + LocalFs/S3 connectors** (GDrive stub + fake), contract suite green.
3. **Transfer + retry + progress hub** (polling reads + SSE), idempotent resume.
4. **Judgment persistence + storage folder** (shared schema/migration, key
   builder), own `judgments` queue wired to OCR semantics.
5. **Meta ops:** embed → `judgment_chunks`, cheap-LLM summary → row; queue
   retry/backoff (BullMQ attempts like existing `document-queue.ts`).
6. **API module** (`ingestion/` index/service/model + tests, registered in
   `modules/index.ts`, auth enabled), then full gate run: lint, typecheck,
   coverage=100%, escomplex, CRAP, knip, Stryker zero survivors.

**Open items for build:** exact cheap summary model; SSE transport detail
(Elysia native stream); whether `judgment_chunks` needs the vector dimension
constant shared with `document_chunks`.
