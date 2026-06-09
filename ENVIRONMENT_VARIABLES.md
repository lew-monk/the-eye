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

### Redis (for BullMQ queues)
```bash
REDIS_URL=redis://localhost:6379
```

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
