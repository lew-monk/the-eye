from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional
import signal

import requests
from bullmq import Queue, Worker

from src.coref import build_pipeline, resolve_coref
from src.paralegal import (
    chunk_text as paralegal_chunk,
    extract_participants,
    load_patterns,
    load_titles,
    normalize_text,
)


COREF_QUEUE_NAME = os.getenv("COREF_QUEUE_NAME", "resolve-coreference")
COREF_MODEL_ARCHITECTURE = os.getenv("COREF_MODEL_ARCHITECTURE", "FCoref")
COREF_MODEL_NAME = os.getenv("COREF_MODEL_NAME", "fastcoref")
COREF_MODEL_VERSION = os.getenv("COREF_MODEL_VERSION", "fastcoref-2.1.6")
COREF_MAX_CHARS = int(os.getenv("COREF_MAX_CHARS", "200000"))

PARALEGAL_CHUNK_MAX_TOKENS = int(os.getenv("PARALEGAL_CHUNK_MAX_TOKENS", "512"))
PARALEGAL_EXTRACTION_VERSION = int(os.getenv("PARALEGAL_EXTRACTION_VERSION", "1"))

API_BASE_URL = os.getenv("API_BASE_URL", "http://api:3001")
API_TOKEN = os.getenv("COREF_SERVICE_TOKEN", "")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

NLP = None
PATTERNS: List[Dict[str, Any]] = []
TITLES: Dict[str, List[str]] = {"prefixes": [], "suffixes": []}


def _headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
        "x-api-key": API_TOKEN,
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


def _coref_chunk_text(text: str, max_chars: int) -> Dict[str, Any]:
    if len(text) <= max_chars:
        return {"chunks": [text], "chunked": False}

    chunks = [text[i: i + max_chars] for i in range(0, len(text), max_chars)]
    return {"chunks": chunks, "chunked": True}


def post_participants(document_id: int, participants: List[Dict[str, Any]]) -> None:
    url = f"{API_BASE_URL}/internal/documents/{document_id}/participants"
    payload = {
        "participants": participants,
        "extractionVersion": PARALEGAL_EXTRACTION_VERSION,
    }
    response = requests.post(url, headers=_headers(),
                             data=json.dumps(payload), timeout=30)
    response.raise_for_status()


def post_chunks(
    document_id: int,
    chunks: List[Dict[str, Any]],
    normalized_text: Optional[str] = None,
) -> None:
    url = f"{API_BASE_URL}/internal/documents/{document_id}/chunks"
    payload: Dict[str, Any] = {
        "chunks": chunks,
        "embeddingVersion": 0,
        "embeddingProvider": "none",
        "embeddingModel": "none",
    }
    if normalized_text is not None:
        payload["normalizedText"] = normalized_text
    response = requests.post(url, headers=_headers(),
                             data=json.dumps(payload), timeout=30)
    response.raise_for_status()


async def process_job(job, job_token) -> Optional[Dict[str, Any]]:
    print("\n" + "=" * 60)
    print("📥 [JOB RECEIVED] New job received!")
    print("=" * 60)
    print(f"🔍 [JOB DATA] Raw job object type: {type(job)}")
    print(f"🔍 [JOB DATA] Job keys: {job.keys() if isinstance(job, dict) else 'N/A'}")
    
    # Handle both dict (manual test) and BullMQ Job object
    job_data = job.get('data') if isinstance(job, dict) else job.data
    print(f"🔍 [JOB DATA] Job data: {job_data}")
    
    document_id = int(job_data.get("documentId"))
    text_hash = job_data.get("textHash")
    
    print(f"📄 [PROCESSING] Document ID: {document_id}")
    print(f"📄 [PROCESSING] Text hash: {text_hash}")
    print("=" * 60)

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
    coref_chunk_info = _coref_chunk_text(extracted_text, COREF_MAX_CHARS)
    text_chunks = coref_chunk_info["chunks"]

    resolved_parts = []
    clusters = []
    mentions = []

    for chunk in text_chunks:
        result = resolve_coref(pipeline, chunk)
        resolved_parts.append(result.resolved_text)
        clusters.extend(result.clusters)
        mentions.extend(result.mentions)

    elapsed_ms = int((time.time() - start) * 1000)

    resolved_text = "\n".join(resolved_parts)

    payload = {
        "resolved_text": resolved_text,
        "clusters": clusters,
        "mentions": mentions,
        "model": COREF_MODEL_NAME,
        "model_version": COREF_MODEL_VERSION,
        "source_text_hash": text_hash or "",
        "processed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "processing_time_ms": elapsed_ms,
        "input_char_count": len(extracted_text),
        "chunked": coref_chunk_info["chunked"],
        "chunk_size": COREF_MAX_CHARS,
        "chunk_count": len(text_chunks),
    }
    print(payload)

    print(f"📤 [POSTING] Posting coref results to API for document {document_id}")
    try:
        post_coref_result(document_id, payload)
        print(f"✅ [POSTED] Coref results posted successfully to API")
    except Exception as e:
        print(f"❌ [POST ERROR] Failed to post coref results to API: {e}")
        raise

    participants = extract_participants(clusters, mentions, resolved_text, PATTERNS, TITLES, NLP)
    print(f"👤 [PARTICIPANTS] Extracted {len(participants)} participants")

    if participants:
        try:
            post_participants(document_id, participants)
            print(f"✅ [POSTED] Participants posted successfully to API")
        except Exception as e:
            print(f"❌ [POST ERROR] Failed to post participants: {e}")
            raise

    normalized_text = normalize_text(resolved_text, participants, mentions)
    print(f"📝 [NORMALIZE] Text normalized ({len(normalized_text)} chars)")

    paralegal_chunks = paralegal_chunk(normalized_text, PARALEGAL_CHUNK_MAX_TOKENS)
    print(f"🧩 [CHUNKS] Generated {len(paralegal_chunks)} chunks")

    if paralegal_chunks:
        try:
            post_chunks(document_id, paralegal_chunks, normalized_text)
            print(f"✅ [POSTED] Chunks + normalized text posted successfully to API")
        except Exception as e:
            print(f"❌ [POST ERROR] Failed to post chunks: {e}")
            raise
    
    print(f"✅ [JOB COMPLETE] Successfully processed document {document_id}")
    print("=" * 60 + "\n")
    return {"stored": True}


# Manual test job - commented out for production testing
# job = {
#     "data": {
#         "documentId": "75",
#         "textHash": "1234",
#     },
# }
async def main() -> None:
    print("=" * 60)
    print("🚀 [COREF WORKER] Starting coreference worker")
    print("=" * 60)
    print(f"📝 [CONFIG] Queue name: {COREF_QUEUE_NAME}")
    print(f"📝 [CONFIG] Redis URL: {REDIS_URL}")
    print(f"📝 [CONFIG] Model architecture: {COREF_MODEL_ARCHITECTURE}")
    print(f"📝 [CONFIG] API base URL: {API_BASE_URL}")
    print("=" * 60)
    
    print(f"🔧 [PIPELINE] Building pipeline with {COREF_MODEL_ARCHITECTURE} architecture")
    global NLP, PATTERNS, TITLES
    NLP = build_pipeline(model_architecture=COREF_MODEL_ARCHITECTURE)
    print(f"✅ [PIPELINE] Pipeline built successfully")

    patterns_path = Path(__file__).resolve().parent.parent / "patterns.yaml"
    titles_path = Path(__file__).resolve().parent.parent / "titles.yaml"

    print(f"📋 [CONFIG] Loading patterns from {patterns_path}")
    PATTERNS = load_patterns(patterns_path)
    print(f"📋 [CONFIG] Loaded {len(PATTERNS)} role patterns")

    print(f"📋 [CONFIG] Loading titles from {titles_path}")
    TITLES = load_titles(titles_path)
    prefixes = len(TITLES["prefixes"])
    suffixes = len(TITLES["suffixes"])
    print(f"📋 [CONFIG] Loaded {prefixes} title prefixes, {suffixes} title suffixes")

    print(f"🔌 [REDIS] Connecting to Redis at {REDIS_URL}")
    queue = Queue(COREF_QUEUE_NAME, {"connection": REDIS_URL})
    
    # Check queue status
    try:
        job_counts = await queue.getJobCounts()
        print(f"📊 [QUEUE STATUS] Job counts: {job_counts}")
    except Exception as e:
        print(f"⚠️  [QUEUE STATUS] Could not get job counts: {e}")
    
    print(f"👷 [WORKER] Creating worker for queue: {COREF_QUEUE_NAME}")
    worker = Worker(COREF_QUEUE_NAME, process_job, {"connection": REDIS_URL})
    
    print("=" * 60)
    print(f"✅ [WORKER] Worker started and listening on queue: {COREF_QUEUE_NAME}")
    print(f"⏳ [WORKER] Waiting for jobs...")
    print("=" * 60)

    shutdown_event = asyncio.Event()
    def signal_handler(sig, frame):
        print("Received signal, shutting down gracefully")
        shutdown_event.set()

    # Assign signal handlers to SIGTERM and SIGINT
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    try:
        # Manual test call - commented out for production testing
        # await process_job(job, None)
        while True:
            await asyncio.sleep(1)

    except KeyboardInterrupt:
        print("\n⚠️  [SHUTDOWN] Received keyboard interrupt")
    except Exception as e:
        print(f"\n❌ [ERROR] Worker encountered error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        print("🛑 [SHUTDOWN] Closing worker and queue connections...")
        await worker.close()
        await queue.close()
        print("✅ [SHUTDOWN] Shutdown complete")
if __name__ == "__main__":
    asyncio.run(main())
