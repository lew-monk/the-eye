# Plan: Persist original PDFs via MinIO (S3-compatible)

## Goal

Save original uploaded PDFs/images in a **private** object store so apps can download them later. **v1 does not change Azure OCR** (still buffer/base64 → octet-stream). Local + prod path starts with **MinIO** (S3 API). Cloud S3 or Azure Blob can be swapped later **without a new interface or app-facing class**.

## Decisions (locked)

| Choice | Value |
|--------|--------|
| Provider (v1) | MinIO (S3-compatible) |
| OCR depth | Persist + app download only (no urlSource, no queue-by-key yet) |
| Local dev | MinIO in `docker-compose.dev.yml` |
| Privacy | Private bucket; apps get short-lived presigned GET URLs (or authenticated stream proxy) |
| Storage API design | **Single app-facing class + one interface; drivers are swappable** |

## Why not Azure Blob / AWS free tier (context)

- **Azure Blob free**: ~5 GB LRS hot + ops for **12 months** (new accounts only) — best DI integration later via SAS + `urlSource`.
- **AWS S3 free**: credits / always-free limits vary; DI would need a public/presigned HTTPS URL.
- **MinIO now**: $0 local, same S3 SDK path; later point env at real S3, or add an Azure Blob **driver** behind the same interface.

## Current state (problem)

- Upload → in-memory `Buffer` → BullMQ **base64** → Azure POST body.
- DB has metadata + OCR text only — **no original file**.
- Re-download / re-OCR from storage is impossible after the job leaves Redis.

## Target architecture (v1)

```
[Browser FormData]
       │
       ▼
[API /upload] ── Buffer
       │
       ├─► ObjectStorage.putObject(...)   ← single class; driver = minio|s3|azure
       │         │
       │         ▼
       │   documents.storage_key, storage_bucket, content_type
       │
       └─► existing OCR queue (base64 unchanged)

[App download]
  GET /documents/:id/file
    → auth check
    → ObjectStorage.getObject / getPresignedGetUrl
```

**Out of scope for v1** (follow-ups): queue carries `storageKey` only; Azure `urlSource` + SAS; chunk temp blobs; parallel Azure submits.

---

## Storage module design (swap without new app API)

**Requirement:** Switching MinIO → AWS S3 → Azure Blob must **not** force a new interface or a new class that call sites import. Call sites always use one facade.

### Shape

```
packages/core/src/services/storage/
  types.ts           # ObjectStorageDriver interface (internal contract)
  object-storage.ts  # ObjectStorage class — only type apps import/use
  drivers/
    s3-driver.ts     # MinIO + AWS S3 (path-style flag)
    azure-blob-driver.ts  # optional later; same driver interface
  index.ts           # getObjectStorage() singleton from env
```

### Internal driver interface (stable)

```ts
interface ObjectStorageDriver {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>
  getObject(key: string): Promise<{
    body: Readable | Buffer
    contentType?: string
    contentLength?: number
  }>
  getPresignedGetUrl(key: string, expiresSeconds: number): Promise<string>
  deleteObject(key: string): Promise<void>
}
```

### App-facing class (stable)

```ts
class ObjectStorage {
  constructor(private driver: ObjectStorageDriver) {}

  putObject(...)          { return this.driver.putObject(...) }
  getObject(...)          { return this.driver.getObject(...) }
  getPresignedGetUrl(...) { return this.driver.getPresignedGetUrl(...) }
  deleteObject(...)       { return this.driver.deleteObject(...) }
}
```

### Factory / env swap

```ts
// STORAGE_PROVIDER=minio | s3 | azure
function createObjectStorageDriver(): ObjectStorageDriver {
  switch (process.env.STORAGE_PROVIDER ?? 'minio') {
    case 'minio':
    case 's3':
      return new S3Driver({ /* S3_* / MinIO endpoint, forcePathStyle */ })
    case 'azure':
      return new AzureBlobDriver({ /* AZURE_STORAGE_* */ })
    default:
      throw new Error(`Unknown STORAGE_PROVIDER`)
  }
}

function getObjectStorage(): ObjectStorage {
  // singleton: new ObjectStorage(createObjectStorageDriver())
}
```

### Rules

1. **Upload, download, OCR follow-ups** only import `getObjectStorage` / `ObjectStorage` — never a concrete driver.
2. **MinIO and AWS S3 share `S3Driver`** (same API; differ by endpoint + `forcePathStyle` + credentials).
3. **Azure Blob is a second driver** implementing the **same** `ObjectStorageDriver` — not a parallel `AzureObjectStorage` class for apps.
4. Adding a provider = new file under `drivers/` + one `switch` branch — **zero** call-site changes.
5. Optional later: inject driver in tests (`new ObjectStorage(mockDriver)`).

### v1 scope for drivers

- Implement **`S3Driver` only** (covers MinIO now and real S3 later).
- Stub or omit `AzureBlobDriver` until needed; design leaves the slot open.

---

## Implementation plan

### 1. Infra — MinIO in compose

**Files:** `docker-compose.dev.yml` (+ prod compose if used)

- Service `minio`:
  - Image `minio/minio`
  - Ports `9000` (API), `9001` (console)
  - Env: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`
  - Volume `minio_data`
  - Command: `server /data --console-address ":9001"`
- Optional one-shot `minio-init` (mc) to create private bucket `the-eye-documents` and set no public policy.
- Wire API service env:
  - `STORAGE_PROVIDER=minio`
  - `S3_ENDPOINT=http://minio:9000`
  - `S3_REGION=us-east-1`
  - `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`
  - `S3_BUCKET=the-eye-documents`
  - `S3_FORCE_PATH_STYLE=true` (required for MinIO)
- Document vars in `.env.example` / `ENVIRONMENT_VARIABLES.md`.

### 2. Schema — storage columns on `documents`

**Files:**
- `packages/shared/src/schemas/documents.ts`
- New Drizzle migration under `packages/shared/src/migrations/`

Add nullable columns (existing rows stay valid):

| Column | Type | Purpose |
|--------|------|---------|
| `storage_key` | text | Object key in bucket/container |
| `storage_bucket` | text | Bucket/container name (multi-env safety) |
| `content_type` | text | MIME (e.g. `application/pdf`) |

Index optional: `storage_key` unique if desired (not required if key embeds doc id).

### 3. Storage module (as designed above)

**Deps:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` in `packages/core` for `S3Driver`.

**Key format:**

```
documents/{caseId|unassigned}/{documentId}/{fileHash}{ext}
```

Stable, unique, easy to debug. Use `fileHash` after hash is computed so dedup can reuse the same object if re-uploaded.

### 4. Upload path — put object then queue OCR

**Files:**
- `packages/core/src/ocr-service.ts` (primary)
- Possibly `apps/api/src/modules/upload/service.ts` (only if logging needed)

Flow change in `OCRService.processDocument`:

1. Validate + `fileHash` (existing).
2. Dedup hit → return existing id (no re-upload unless `storage_key` missing → backfill put).
3. Create document row (existing).
4. **NEW:** `getObjectStorage().putObject(key, fileBuffer, mime)` then `documentRepository.updateById` with `storageKey`, `storageBucket`, `contentType`.
5. Log stage e.g. `storage_persisted` via pipeline log.
6. Existing queue/sync OCR unchanged.

**Failure policy:**
- If put fails → mark document `failed` (or delete row) and do **not** queue OCR without a durable original (v1 preference: fail closed).
- If put succeeds and queue fails → document exists with file in store; status can stay `queued`/`failed` with clear error (retry later without re-upload).

**MIME:** reuse `getMimeType(filename)` from `@workspace/shared`.

### 5. Download API — authenticated file access

**New routes** under documents module (or cases):

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/documents/:id/file` | Auth required; stream via `ObjectStorage.getObject` with `Content-Disposition: attachment; filename="…"` |
| Optional | `/documents/:id/file-url` | Returns short-lived presigned URL (e.g. 5–15 min) via `getPresignedGetUrl` |

**Files:**
- `apps/api/src/modules/documents/` or extend existing documents/cases router
- Service method: load doc → require `storageKey` → stream or sign
- tRPC proxy if frontend uses tRPC for cases (match existing upload pattern)

**Auth:** same guards as other document endpoints (`VITE_ENABLE_AUTH` / API auth). Never expose anonymous public bucket.

**404 cases:** missing doc, missing `storage_key`, object not found in store.

### 6. Frontend (minimal)

- On case/document UI: “Download original” button calling download endpoint (or opening presigned URL).
- Use `@workspace/ui` `Button`.
- No full file browser required in v1.

### 7. Pipeline logging

Add stages (console + optional `processing_logs`):

- `storage_persisted` — key, bucket, bytes, provider
- `storage_failed` — error
- Download can stay request-log only (no need for processing_logs)

### 8. Tests

- Unit: key builder; `ObjectStorage` with mock `ObjectStorageDriver`
- Unit: factory selects `S3Driver` for `minio` / `s3`
- Integration (optional with MinIO or mocked S3): upload path sets `storage_key`
- API: download 404 without key; 200 streams when mock returns body
- Existing OCR tests unchanged (buffer path)

### 9. Docs / env

- `.env.example`: `STORAGE_PROVIDER` + all `S3_*` vars (and later `AZURE_STORAGE_*`)
- Short note in README or `docs/` — MinIO console URL, default bucket, that OCR still uses buffers, how to switch provider

---

## Explicit non-goals (v1)

- Removing base64 from BullMQ
- Azure DI `urlSource` / SAS for OCR
- Parallel chunk OCR
- Migrating historical documents (no originals exist)
- Public bucket ACLs
- Multipart upload for >200MB (upload cap remains 200MB; single PUT is fine)
- Implementing Azure Blob driver (design only; implement when switching)

---

## Follow-up phases (not this PR)

| Phase | Work | Benefit |
|-------|------|---------|
| 2 | Queue job = `{ documentId, storageKey }` + worker `getObject` | Shrink Redis; safer large PDFs |
| 3 | Presigned URL → Azure `urlSource` (or temp chunk objects) | Faster Azure submit; less app→Azure bandwidth |
| 4 | Parallel chunk OCR | Wall-clock OCR speed |
| 5 | `STORAGE_PROVIDER=s3` or `azure` + Azure driver | Managed prod storage; no call-site rewrite |

---

## Implementation order

1. Compose MinIO + env
2. Schema migration + types
3. `ObjectStorageDriver` + `ObjectStorage` + `S3Driver` + factory
4. Hook upload (`ocr-service`) put + DB update
5. Download API
6. UI download button
7. Tests + docs

## Risks / notes

- **Disk:** MinIO volume grows with every upload; plan retention later.
- **Dedup:** if hash matches existing doc, skip put; if first copy lacked storage (legacy), backfill on next upload of same hash only when creating new row — legacy rows without files stay undownloadable.
- **Secrets:** root MinIO creds only in `.env`, not committed.
- **Path-style:** must stay on for MinIO; real AWS often works with virtual-hosted — keep `S3_FORCE_PATH_STYLE` configurable on `S3Driver`.
- **Swap cost:** only env + optional new driver file; apps keep `getObjectStorage()`.

## Success criteria

- [ ] Upload stores object via `ObjectStorage` and sets `storage_key` on document
- [ ] Authenticated download returns original bytes with correct filename/content-type
- [ ] OCR pipeline still works unchanged (queue + Azure buffer path)
- [ ] `docker compose` brings up MinIO; API talks to it through `S3Driver`
- [ ] Call sites depend only on `ObjectStorage` / `getObjectStorage` — provider swap needs no new app-facing class or interface
