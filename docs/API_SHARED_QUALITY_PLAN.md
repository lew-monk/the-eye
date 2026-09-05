# API and Shared Packages Quality Plan

Status: recommendations only. This document does not change source code.

Scope: `apps/api`, `packages/shared`, `packages/core`, and `packages/coreference-worker`. The web application and UI packages are intentionally deferred.

## Objective

Bring the API and shared packages to these enforceable targets:

- cyclomatic complexity `< 22` per function;
- cognitive complexity `< 22` per function;
- Halstead difficulty `< 80` per function/module, using one documented analyzer;
- fewer than 500 lines per source file;
- 100% statement, branch, function, and line coverage for in-scope code;
- CRAP score `< 25`;
- no surviving mutants;
- no dead or redundant code;
- no `any` or `unknown` types in production or test code.

These are quality gates, not reasons to flatten domain logic. Complexity should be moved behind deep, typed modules with narrow interfaces and tested seams.

## Baseline observed

- `apps/api/src/modules/cases/service.ts` is 1,764 lines and is the main file-size and complexity hotspot.
- The largest remaining API files are `cases/index.ts` (491 lines), `entities/service.ts` (493 lines), and `cases/linker.ts` (432 lines).
- `packages/shared` has several repository and persistence seams using `any`, including `base.ts`, `document.ts`, `case.ts`, `participant.ts`, `chunk.ts`, `case-relation.ts`, and `queue.ts`.
- API services accept untyped payloads in places such as coreference and participant/chunk ingestion.
- `unknown` is used in document JSON and linker parsing. It should be replaced with runtime-validated domain types, not blindly cast away.
- `packages/core` contains the second major TypeScript processing path: OCR orchestration, Azure response mapping, PDF chunking, storage, and queues. Several of these files use `any`/`unknown` at SDK and JSON seams.
- `packages/coreference-worker/src/worker.py` (486 lines) and `src/paralegal.py` (447 lines) are close to the file-size limit and use broad `Dict[str, Any]` payloads throughout. The Python worker has one focused test file for chunking, leaving OCR extraction, coreference mapping, participant extraction, HTTP behavior, retries, and job orchestration under-tested.
- The Python worker catches broad `Exception` in its long-running job path. Failure classification and retry/acknowledgement behavior need explicit typed errors and tests before mutation testing can be meaningful.
- Shared tests currently cover important embedding/RAG helpers. The API suite has broad unit coverage, but the web package has no test files; UI coverage is outside this phase.
- Direct package type-checking currently reports Redis/BullMQ version incompatibilities in `packages/core` and strict TypeScript errors in API/core code. This plan treats a clean type-check as a prerequisite, not as an optional polish item.
- The root `typecheck` script currently recursively invokes itself under Bun workspace filtering and must be replaced with explicit package commands.

## Recommended architecture changes

### 1. Split the case intelligence module by domain capability

Files: `apps/api/src/modules/cases/service.ts`, `cases/index.ts`, `cases/linker.ts`, related tests.

Extract deep modules with narrow interfaces:

- case overview and document retrieval;
- similarity scoring and ranking;
- chronology/date extraction;
- document graph/reference linking;
- entity aggregation, confidence, and trajectories;
- manual participant operations.

Keep route handlers thin. Each extracted module should own its input/output types, invariants, and failure modes. Preserve the existing public route contract while reducing the 1,764-line service into files comfortably below 500 lines.

### 2. Introduce typed request and persistence models at every API seam

Files: API `model.ts` files, internal document/chunk/participant/coreference routes and services, `packages/shared/src/schemas/*`.

Define schemas for OCR/coreference payloads, participant rows, chunk rows, query parameters, JSON document content, and API-key administration. Parse at ingress with Elysia/Zod schemas, then pass typed values through services. Replace `Record<string, any>` with explicit JSON value/object types and discriminated unions where data has variants.

No `as any`, `Promise<any>`, or `unknown` should remain. Where external libraries return untyped values, add a typed adapter that validates and narrows once at the seam.

### 3. Make repositories generic without leaking Drizzle internals

Files: `packages/shared/src/repositories/base.ts`, `document.ts`, `case.ts`, `participant.ts`, `chunk.ts`, `case-relation.ts`.

Replace `any[]` conditions/options and `as any` row casts with typed repository query objects. Define explicit result DTOs for joins and aggregates. Keep table-specific fields inside each repository rather than exposing dynamic field access to callers. This reduces redundant casts and gives mutation testing a stable seam.

### 4. Separate scoring algorithms from orchestration

Files: `apps/api/src/modules/internal/chunks/service.ts`, `packages/shared/src/similar.ts`, participant recalibration code, case similarity paths.

Move pure algorithms into small modules:

- entity-overlap scoring;
- weighted mean-of-max chunk scoring;
- participant relevance/recalibration;
- score explanation/reason generation;
- embedding dimension/model validation.

The service should orchestrate repositories and queue calls; it should not contain nested scoring loops, persistence branching, and response formatting in one function.

### 5. Treat external infrastructure as adapters

Files: `packages/shared/src/queue.ts`, API auth middleware, shared persistence/database modules.

Define interfaces for queue operations, API-key checks, clock/time, and database operations. Provide production adapters and deterministic test fakes. Resolve the duplicate `ioredis` versions used by BullMQ before type-checking; do not solve it with casts.

### 6. Make authorization a domain invariant

Files: API route modules, auth middleware, case/document repositories.

Introduce a typed authorization context and require it for every case/document/entity/graph/search/read/download path. Enforce case membership and privileged-document filtering in repository queries, before ranking or retrieval. Keep service-token authentication separate from end-user authorization. Add negative tests for cross-user and privileged-document access.

### 7. Deepen the OCR and storage pipeline

Files: `packages/core/src/ocr.ts`, `ocr-service.ts`, `services/ocr/document-processor.ts`, `services/ocr/pdf-chunker.ts`, `services/ocr/azure-client.ts`, `services/ocr/extract/*`, and `services/storage/*`.

Split provider interaction, OCR-result normalization, document persistence, chunking, and pipeline orchestration into separate modules. Add a typed Azure adapter that converts SDK responses into an internal `AnalyzeResult` model once. Keep PDF/native extraction and Azure fallback behind an extraction strategy seam. Make retry policy, confidence thresholds, and idempotency explicit interfaces rather than branches spread through the orchestrator.

The public OCR service should expose a small typed result and status interface. It should not expose Azure SDK response shapes or database-specific objects. This lowers cognitive/CRAP scores while improving test locality: provider failures, malformed responses, duplicate hashes, partial pages, and storage failures can be tested independently.

### 8. Replace Python dictionary payloads with typed worker contracts

Files: `packages/coreference-worker/src/worker.py`, `paralegal.py`, `coref.py`, `pdf_extract.py`, YAML config loaders, and `tests/`.

Define `TypedDict` or frozen dataclass contracts for extracted text, pages, mentions, coreference clusters, participants, chunks, embedding metadata, API envelopes, and job payloads. Use `Literal`/enums for roles, entity types, processing stages, and job outcomes. Parse YAML, HTTP JSON, and model outputs at the ingress seam; internal functions should receive typed objects rather than `Dict[str, Any]`.

The no-`any` rule applies to Python `Any` as well: eliminate `typing.Any` from hand-written production and test code. Third-party libraries without useful stubs should be isolated behind small typed adapters, with narrowly scoped stub files where necessary. Keep `# type: ignore` only when a pinned dependency defect is documented and tested; the target is zero such suppressions in application code.

### 9. Split the coreference worker by pipeline stage

Keep `worker.py` as a thin job adapter and move behavior into modules for:

- job validation and outcome classification;
- API transport/authentication and response decoding;
- coreference model execution;
- participant extraction and role matching;
- normalization and chunk construction;
- PDF extraction strategy selection;
- persistence payload construction and retry policy.

This should bring each source file and function below the requested limits without hiding behavior in generic helpers. Preserve the independent participant/chunk POST semantics, but return a typed per-stage result so partial failure is visible and retryable.

### 10. Make model and configuration loading deterministic

Files: Python YAML loaders, `coref.py`, `paralegal.py`, `packages/core/src/services/ocr/model-manager.ts`, and worker startup code.

Validate `patterns.yaml`, `titles.yaml`, and `weights.yaml` against schemas at startup. Include configuration version/hash in processing output. Inject model loaders and clocks into the worker so tests never download models or depend on wall-clock timing. Define explicit behavior for missing, malformed, or incompatible model/config versions.

## Testing and quality gates

### Coverage

Use package-local coverage with Bun/Vitest, merge reports in CI, and fail on 100% lines, functions, statements, and branches for in-scope production files. Exclude generated route declarations only through an explicit, reviewed coverage config. Do not exclude complex code merely because it is difficult to test.

Prioritize tests through public module interfaces and adapters, including:

- all authorization permutations;
- malformed and versioned ingestion payloads;
- missing documents, partial processing, retries, and idempotency;
- null/mixed embedding models and dimensions;
- empty, duplicate, and colliding entity names;
- superseded/current document filtering;
- database and queue failures;
- exact route status/body contracts.

### Mutation testing

Adopt one mutation tool compatible with Bun/TypeScript (or run the TypeScript build through the selected tool). Start with scoring, authorization, repository predicates, and ingestion validation. Require zero surviving mutants in the in-scope packages. Record justified equivalent mutants rather than silently excluding files.

### Complexity and Halstead

Choose one analyzer and pin its version. Run it per function and file in CI. The report must include cyclomatic, cognitive, Halstead difficulty, CRAP, and line count. Set warning thresholds below the hard limits to prevent regressions (for example 18/18/70/20).

### Dead and redundant code

Use a combination of TypeScript compiler diagnostics, Knip or equivalent export/import analysis, duplicate-code detection, and manual review of route/service seams. Remove unreachable branches, stale generated artifacts, duplicate route logic, and unused exports only after tests prove they are not part of a public contract.

For Python, add Ruff (including unused imports/variables), Pyright in strict mode, and a duplicate-code check. Exclude `.venv`, generated files, model caches, and build output from all measurements. Do not count `packages/core/dist` or the Python virtual environment as application source.

### Python coverage and mutation gates

Use `pytest --cov` with branch coverage and fail at 100% for `src/`. Add tests for each adapter and pure stage before testing the full BullMQ loop. Use deterministic fakes for Redis, HTTP, OCR providers, spaCy/fastcoref, and embedding calls. Mutation testing should target participant extraction, role precedence, name normalization, chunk boundaries, confidence thresholds, retry classification, and payload posting. Require zero survivors; explicitly review equivalent mutants.

## Suggested execution order

1. Add CI measurement/configuration and fix the recursive root scripts.
2. Resolve dependency/type-check blockers, especially the duplicate `ioredis` versions.
3. Introduce TypeScript domain JSON/request types and remove `any`/`unknown` at ingress seams.
4. Split `cases/service.ts` and extract scoring/linking algorithms.
5. Type and simplify shared repositories and queue/auth adapters.
6. Deepen the OCR/storage pipeline and isolate Azure/S3/BullMQ adapters.
7. Add typed Python worker contracts, strict Pyright/Ruff checks, and deterministic model/config loading.
8. Split the Python worker into job, transport, NLP, extraction, and payload modules.
9. Add authorization invariants and negative tests.
10. Raise TypeScript and Python branch coverage to 100%, then run mutation testing and remove survivors.
11. Run dead-code/duplicate-code checks and perform a final complexity review.
12. Re-run all gates in CI and publish the reports as build artifacts.

## Definition of done for this phase

- All API/shared/core TypeScript and coreference-worker Python production and test files are under 500 lines.
- No TypeScript `any`/`unknown` or Python `Any`/untyped dictionary payloads remain except in an explicitly approved generated/vendor declaration; the approval list is empty for hand-written code.
- Type-check, build, tests, coverage, complexity, CRAP, mutation, dead-code, and duplicate-code checks all pass in CI.
- Python passes strict static analysis and branch coverage; worker failure/acknowledgement behavior is covered with deterministic fakes.
- All API retrieval and download paths enforce typed authorization context and case/privilege filtering.
- Public route behavior is unchanged unless a security defect requires a documented breaking change.
- UI and UI-specific coverage remain explicitly out of scope until this phase is complete.
