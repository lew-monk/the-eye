from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import asdict
from typing import Any, Dict, Optional

import requests
from bullmq import Queue, Worker

from coref import build_pipeline, resolve_coref


COREF_QUEUE_NAME = os.getenv("COREF_QUEUE_NAME", "coreference-resolution")
COREF_MODEL_NAME = os.getenv("COREF_MODEL_NAME", "spacy-neuralcoref")
COREF_MODEL_VERSION = os.getenv("COREF_MODEL_VERSION", "spacy-neuralcoref")
COREF_MAX_CHARS = int(os.getenv("COREF_MAX_CHARS", "200000"))

API_BASE_URL = os.getenv("API_BASE_URL", "http://api:3001")
API_TOKEN = os.getenv("COREF_SERVICE_TOKEN", "")

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

NLP = None


def _headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }


def fetch_extracted_text(document_id: int) -> Dict[str, Any]:
    url = f"{API_BASE_URL}/internal/documents/{document_id}/extracted-text"
    response = requests.get(url, headers=_headers(), timeout=30)
    response.raise_for_status()
    return response.json()


def post_coref_result(document_id: int, payload: Dict[str, Any]) -> None:
    url = f"{API_BASE_URL}/internal/documents/{document_id}/coreference"
    response = requests.post(url, headers=_headers(),
                             data=json.dumps(payload), timeout=30)
    response.raise_for_status()


def chunk_text(text: str, max_chars: int) -> Dict[str, Any]:
    if len(text) <= max_chars:
        return {"chunks": [text], "chunked": False}

    chunks = [text[i: i + max_chars] for i in range(0, len(text), max_chars)]
    return {"chunks": chunks, "chunked": True}


async def process_job(job) -> Optional[Dict[str, Any]]:
    document_id = int(job.data.get("documentId"))
    text_hash = job.data.get("textHash")

    meta = fetch_extracted_text(document_id)
    extracted_text = meta.get("text", "")
    existing_source_hash = meta.get("coreferenceSourceTextHash")

    if not extracted_text:
        return {"skipped": True, "reason": "empty_text"}

    if existing_source_hash and text_hash and existing_source_hash == text_hash:
        return {"skipped": True, "reason": "already_processed"}

    pipeline = NLP
    if pipeline is None:
        raise RuntimeError("NLP pipeline not initialized")

    start = time.time()
    chunk_info = chunk_text(extracted_text, COREF_MAX_CHARS)
    chunks = chunk_info["chunks"]

    resolved_parts = []
    clusters = []
    mentions = []

    for chunk in chunks:
        result = resolve_coref(pipeline, chunk)
        resolved_parts.append(result.resolved_text)
        clusters.extend(result.clusters)
        mentions.extend(result.mentions)

    elapsed_ms = int((time.time() - start) * 1000)

    payload = {
        "resolved_text": "\n".join(resolved_parts),
        "clusters": clusters,
        "mentions": mentions,
        "model": COREF_MODEL_NAME,
        "model_version": COREF_MODEL_VERSION,
        "source_text_hash": text_hash or "",
        "processed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "processing_time_ms": elapsed_ms,
        "input_char_count": len(extracted_text),
        "chunked": chunk_info["chunked"],
        "chunk_size": COREF_MAX_CHARS,
        "chunk_count": len(chunks),
    }

    post_coref_result(document_id, payload)
    return {"stored": True}


async def main() -> None:
    global NLP
    NLP = build_pipeline()

    queue = Queue(COREF_QUEUE_NAME, {"connection": REDIS_URL})
    worker = Worker(COREF_QUEUE_NAME, process_job, {"connection": REDIS_URL})

    try:
        await worker.wait_until_ready()
        while True:
            await asyncio.sleep(1)
    finally:
        await worker.close()
        await queue.close()


if __name__ == "__main__":
    asyncio.run(main())
