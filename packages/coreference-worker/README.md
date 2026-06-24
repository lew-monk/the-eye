# Coreference Worker

Stateless coreference worker that consumes BullMQ jobs, fetches extracted text
from the API, performs coreference resolution, and posts results back.

## Environment

- `REDIS_URL` (default: `redis://redis:6379`)
- `API_BASE_URL` (default: `http://api:3001`)
- `COREF_SERVICE_TOKEN` (required)
- `COREF_QUEUE_NAME` (default: `coreference-resolution`)
- `COREF_MODEL_NAME` (default: `fastcoref`)
- `COREF_MODEL_VERSION` (default: `fastcoref-2.1.6`)
- `COREF_MAX_CHARS` (default: `200000`)

## Development

Build and run via docker-compose dev service.
