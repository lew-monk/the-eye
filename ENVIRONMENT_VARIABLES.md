# Environment Variables Setup

This document outlines how to configure environment variables for the core package and the entire monorepo.

## Environment Variables Used by Core Package

The core package requires the following environment variables:

### Database Configuration
```bash
DATABASE_URL=postgresql://username:password@localhost:5432/database_name
```

### Azure Document Intelligence
```bash
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_DOCUMENT_INTELLIGENCE_KEY=your-api-key-here
```

### PDF extract strategy
```bash
# azure (default, current pipeline) | pymupdf4llm-hybrid
PDF_EXTRACTOR=azure
# On hybrid failure, run the azure strategy (set none to fail closed)
PDF_EXTRACT_FALLBACK=azure
PDF_EXTRACT_PYTHON=python3
# PDF_EXTRACT_SCRIPT=packages/coreference-worker/src/pdf_extract.py
```

Revert anytime: `PDF_EXTRACTOR=azure` (or unset). Hybrid still falls back to Azure if Python/PyMuPDF is missing unless `PDF_EXTRACT_FALLBACK=none`.

### Embeddings
```bash
# openai (default, production) | ollama
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
# Dev local models:
# EMBEDDING_PROVIDER=ollama
# EMBEDDING_MODEL=nomic-embed-text
# EMBEDDING_DIMENSIONS=768
# OLLAMA_HOST=http://127.0.0.1:11434
```

The worker talks to an `EmbeddingProvider` port (`packages/workers/src/embedding`). Hash-skip and Postgres writes stay in the handler, not in the provider.

### Redis (for BullMQ queues)
```bash
REDIS_URL=redis://localhost:6379
```

### Object storage (original uploads — MinIO / S3)

Persists original PDFs/images via `ObjectStorage` (`packages/core`). OCR still uses in-memory buffers in v1.

```bash
# minio | s3 | none (none = skip put; upload/OCR unchanged)
STORAGE_PROVIDER=minio
S3_ENDPOINT=http://localhost:9000   # http://minio:9000 inside Docker
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=the-eye-documents
S3_FORCE_PATH_STYLE=true            # required for MinIO
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
```

- Console (dev): http://localhost:9001  
- Download / preview API: `GET /documents/:id/file?disposition=inline|attachment` (streams original when `storage_key` is set). When `COREF_SERVICE_TOKEN` or `API_SERVICE_TOKEN` is set, the API requires `x-api-key`. The web BFF checks the user session and forwards the token — the web process must have the same token as the API.  
- Swap to AWS: `STORAGE_PROVIDER=s3`, real credentials, optional `S3_FORCE_PATH_STYLE=false`

### OCR Confidence Thresholds (Optional)
```bash
CONFIDENCE_THRESHOLD_DEFAULT=0.7
CONFIDENCE_THRESHOLD_JUDGMENT=0.8
CONFIDENCE_THRESHOLD_CONTRACT=0.75
CONFIDENCE_THRESHOLD_POLICE_REPORT=0.7
CONFIDENCE_THRESHOLD_WITNESS_STATEMENT=0.7
CONFIDENCE_THRESHOLD_PLEADING=0.75
```

## Setting Up Environment Variables

### 1. Create Environment Files

Create a `.env` file in the root of your project:

```bash
# .env
DATABASE_URL=postgresql://legal_user:legal_pass@localhost:5432/legal_docs
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_DOCUMENT_INTELLIGENCE_KEY=your-api-key-here
REDIS_URL=redis://localhost:6379
```

### 2. Environment File for API App

If you need app-specific variables for the API:

```bash
# apps/api/.env
PORT=3001
```

### 3. Git Ignore

Make sure `.env` files are ignored:

```bash
# .gitignore
.env
.env.local
.env.*.local
```

## Running Applications with Environment Variables

### Development Mode

When running the API app in development:

```bash
# From project root
cd apps/api
bun run dev
```

Environment variables from `.env` files are automatically loaded by Bun.

### Production Mode

For production, set environment variables directly:

```bash
# Option 1: Export variables
export DATABASE_URL="postgresql://..."
export AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT="https://..."
export AZURE_DOCUMENT_INTELLIGENCE_KEY="your-key"
export REDIS_URL="redis://localhost:6379"

cd apps/api
bun run start
```

```bash
# Option 2: Use a .env file with dotenv
cd apps/api
bun add dotenv
# Then load in your index.ts: require('dotenv').config()
bun run start
```

### Docker Deployment

For Docker containers:

```dockerfile
# Dockerfile
FROM oven/bun:latest

# Set environment variables
ENV DATABASE_URL=postgresql://legal_user:legal_pass@db:5432/legal_docs
ENV AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
ENV AZURE_DOCUMENT_INTELLIGENCE_KEY=your-api-key-here
ENV REDIS_URL=redis://redis:6379

WORKDIR /app
COPY . .
RUN bun install
RUN bun run build

EXPOSE 3001
CMD ["bun", "run", "start"]
```

Or use Docker environment files:

```bash
# docker-compose.yml
version: '3.8'
services:
  api:
    build: .
    env_file:
      - .env
    ports:
      - "3001:3001"
```

## Testing with Environment Variables

When running tests for the core package:

```bash
cd packages/core

# Set required env vars for tests
export DATABASE_URL="postgresql://test:test@localhost:5432/test_db"
export AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT="https://test.azure.com"
export AZURE_DOCUMENT_INTELLIGENCE_KEY="test-key"
export REDIS_URL="redis://localhost:6379"

bun run test
```

## Default Values

The core package includes sensible defaults for development:

- `DATABASE_URL`: `postgresql://legal_user:legal_pass@localhost:5432/legal_docs`
- `REDIS_URL`: `redis://localhost:6379`
- Confidence thresholds: Various defaults between 0.7-0.8

Only Azure credentials are required with no defaults.

## Security Notes

- Never commit `.env` files to version control
- Use different credentials for development, staging, and production
- Rotate API keys regularly
- Use environment-specific configuration management tools in production
