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
    load_patterns_config,
    load_titles,
    load_weights,
    normalize_text,
)


COREF_QUEUE_NAME = os.getenv("COREF_QUEUE_NAME", "coreference-resolution")
COREF_MODEL_ARCHITECTURE = os.getenv("COREF_MODEL_ARCHITECTURE", "FCoref")
COREF_MODEL_NAME = os.getenv("COREF_MODEL_NAME", "fastcoref")
COREF_MODEL_VERSION = os.getenv("COREF_MODEL_VERSION", "fastcoref-2.1.6")
COREF_MAX_CHARS = int(os.getenv("COREF_MAX_CHARS", "200000"))

# Embed cap vs retrieval pack size. Short filings used to become one giant chunk
# (the embed window). Retrieval wants paragraph-scale children (default 512).
EMBEDDING_MAX_TOKENS = int(os.getenv("EMBEDDING_MAX_TOKENS", "8192"))
_raw_chunk_max = int(os.getenv("PARALEGAL_CHUNK_MAX_TOKENS", str(EMBEDDING_MAX_TOKENS)))
_retrieval_tokens = int(os.getenv("PARALEGAL_RETRIEVAL_CHUNK_TOKENS", "512"))
PARALEGAL_CHUNK_MAX_TOKENS = min(_raw_chunk_max, _retrieval_tokens, EMBEDDING_MAX_TOKENS)
if _raw_chunk_max > EMBEDDING_MAX_TOKENS:
    print(
        f"⚠️  [CONFIG] PARALEGAL_CHUNK_MAX_TOKENS={_raw_chunk_max} exceeds "
        f"EMBEDDING_MAX_TOKENS={EMBEDDING_MAX_TOKENS}; clamping to {PARALEGAL_CHUNK_MAX_TOKENS}",
        flush=True,
    )
_ENV_EXTRACTION_VERSION = os.getenv("PARALEGAL_EXTRACTION_VERSION")
PARALEGAL_EXTRACTION_VERSION = int(_ENV_EXTRACTION_VERSION) if _ENV_EXTRACTION_VERSION else 1

API_BASE_URL = os.getenv("API_BASE_URL", "http://api:3001")
API_TOKEN = os.getenv("COREF_SERVICE_TOKEN", "")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

NLP = None
PATTERNS: List[Dict[str, Any]] = []
TITLES: Dict[str, List[str]] = {"prefixes": [], "suffixes": []}
WEIGHTS: Dict[str, Any] = {"default": {}, "per_document_type": {}}


def _headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
        "x-api-key": API_TOKEN,
    }


def _http(method: str, url: str, document_id: int, **kwargs: Any) -> requests.Response:
    started = time.time()
    response = requests.request(method, url, headers=_headers(), timeout=60, **kwargs)
    ms = int((time.time() - started) * 1000)
    if not response.ok:
        body = (response.text or "")[:300]
        _doc_log(
            document_id,
            "coref_http_error",
            method=method,
            url=url,
            status=response.status_code,
            ms=ms,
            body=body,
        )
        response.raise_for_status()
    _doc_log(document_id, "coref_http_ok", method=method, path=url.split("/internal")[-1], status=response.status_code, ms=ms)
    return response


def fetch_extracted_text(document_id: int) -> Dict[str, Any]:
    url = f"{API_BASE_URL}/internal/documents/{document_id}/extracted-text"
    return _http("GET", url, document_id).json()


def post_coref_result(document_id: int, payload: Dict[str, Any]) -> None:
    url = f"{API_BASE_URL}/internal/documents/{document_id}/coreference"
    _http("POST", url, document_id, data=json.dumps(payload))


def _coref_chunk_text(text: str, max_chars: int) -> Dict[str, Any]:
    if len(text) <= max_chars:
        return {"chunks": [text], "chunked": False}

    chunks = [text[i: i + max_chars] for i in range(0, len(text), max_chars)]
    return {"chunks": chunks, "chunked": True}


def _doc_log(document_id: int, stage: str, **details: Any) -> None:
    """Console stage log matching TS pipeline format: [DOC n] stage {...}"""
    if details:
        print(f"[DOC {document_id}] {stage} {details}", flush=True)
    else:
        print(f"[DOC {document_id}] {stage}", flush=True)


def post_participants(document_id: int, participants: List[Dict[str, Any]]) -> None:
    url = f"{API_BASE_URL}/internal/documents/{document_id}/participants"
    payload = {
        "participants": participants,
        "extractionVersion": PARALEGAL_EXTRACTION_VERSION,
    }
    _http("POST", url, document_id, data=json.dumps(payload))


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
    _http("POST", url, document_id, data=json.dumps(payload))


async def process_job(job, job_token) -> Optional[Dict[str, Any]]:
    # Handle both dict (manual test) and BullMQ Job object
    job_data = job.get("data") if isinstance(job, dict) else job.data
    document_id = int(job_data.get("documentId"))
    text_hash = job_data.get("textHash")
    job_id = job.get("id") if isinstance(job, dict) else getattr(job, "id", None)
    job_started = time.time()

    _doc_log(
        document_id,
        "coref_started",
        jobId=job_id,
        textHash=text_hash,
        model=COREF_MODEL_NAME,
        architecture=COREF_MODEL_ARCHITECTURE,
        maxChars=COREF_MAX_CHARS,
        extractionVersion=PARALEGAL_EXTRACTION_VERSION,
        api=API_BASE_URL,
    )

    try:
        _doc_log(document_id, "coref_fetching_text")
        meta = fetch_extracted_text(document_id)
        extracted_text = meta.get("text", "")
        document_type = meta.get("documentType", "")
        existing_source_hash = meta.get("coreferenceSourceTextHash")

        existing_coref = meta.get("existingCoref") or {}
        _doc_log(
            document_id,
            "coref_fetched",
            chars=len(extracted_text),
            documentType=document_type or None,
            existingHash=existing_source_hash or None,
            incomingHash=text_hash or None,
            hasResolvedPayload=bool(existing_coref.get("resolvedText")),
        )

        if not extracted_text:
            _doc_log(document_id, "coref_skipped", reason="empty_text")
            return {"skipped": True, "reason": "empty_text"}

        reused_coref = bool(
            existing_source_hash
            and text_hash
            and existing_source_hash == text_hash
            and existing_coref.get("resolvedText")
        )

        if not reused_coref and (existing_source_hash or existing_coref):
            _doc_log(
                document_id,
                "coref_reuse_skipped",
                hashMatch=bool(existing_source_hash and text_hash and existing_source_hash == text_hash),
                hasResolvedPayload=bool(existing_coref.get("resolvedText")),
            )

        participants_posted = False
        chunks_posted = False

        if reused_coref:
            resolved_text = existing_coref["resolvedText"]
            clusters = existing_coref.get("clusters") or []
            mentions = existing_coref.get("mentions") or []
            _doc_log(
                document_id,
                "coref_reused",
                reason="source_hash_match",
                clusters=len(clusters),
                mentions=len(mentions),
                resolvedChars=len(resolved_text),
                note="skipping inference; still running extract + chunk",
            )
        else:
            pipeline = NLP
            if pipeline is None:
                raise RuntimeError("NLP pipeline not initialized")

            coref_chunk_info = _coref_chunk_text(extracted_text, COREF_MAX_CHARS)
            text_chunks = coref_chunk_info["chunks"]
            chunk_count = len(text_chunks)

            _doc_log(
                document_id,
                "coref_chunking",
                chunked=coref_chunk_info["chunked"],
                chunkCount=chunk_count,
                chunkSize=COREF_MAX_CHARS,
                inputChars=len(extracted_text),
            )

            resolved_parts = []
            clusters = []
            mentions = []

            inference_started = time.time()
            _doc_log(
                document_id,
                "coref_inference_started",
                chunkCount=chunk_count,
                note="CPU inference can take many minutes on large docs",
            )

            for idx, chunk in enumerate(text_chunks, start=1):
                chunk_started = time.time()
                _doc_log(
                    document_id,
                    "coref_inference_progress",
                    chunk=idx,
                    of=chunk_count,
                    chunkChars=len(chunk),
                    status="running",
                )
                result = resolve_coref(pipeline, chunk)
                chunk_ms = int((time.time() - chunk_started) * 1000)
                resolved_parts.append(result.resolved_text)
                clusters.extend(result.clusters)
                mentions.extend(result.mentions)
                _doc_log(
                    document_id,
                    "coref_inference_progress",
                    chunk=idx,
                    of=chunk_count,
                    chunkChars=len(chunk),
                    status="done",
                    ms=chunk_ms,
                    clusters=len(result.clusters),
                    mentions=len(result.mentions),
                )

            elapsed_ms = int((time.time() - inference_started) * 1000)
            resolved_text = "\n".join(resolved_parts)

            _doc_log(
                document_id,
                "coref_inference_done",
                ms=elapsed_ms,
                clusters=len(clusters),
                mentions=len(mentions),
                resolvedChars=len(resolved_text),
            )

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
                "chunk_count": chunk_count,
            }

            _doc_log(document_id, "coref_posting", clusters=len(clusters), mentions=len(mentions))
            try:
                post_coref_result(document_id, payload)
                _doc_log(document_id, "coref_completed", ms=elapsed_ms)
            except Exception as e:
                _doc_log(document_id, "coref_failed", stage="post_coref", error=str(e))
                raise

        participants = extract_participants(
            clusters, mentions, resolved_text, PATTERNS, TITLES, NLP
        )
        sample = [
            f"{p.get('name')} ({p.get('role')})"
            for p in participants[:8]
        ]
        _doc_log(
            document_id,
            "coref_participants",
            count=len(participants),
            sample=sample,
        )

        if not participants:
            _doc_log(document_id, "coref_participants_empty", note="nothing to post")
        else:
            try:
                post_participants(document_id, participants)
                participants_posted = True
                _doc_log(document_id, "coref_participants_posted", count=len(participants))
            except Exception as e:
                _doc_log(document_id, "coref_failed", stage="post_participants", error=str(e))

        normalized_text = normalize_text(resolved_text, participants, mentions)
        _doc_log(document_id, "coref_normalized", chars=len(normalized_text))

        paralegal_chunks = paralegal_chunk(
            normalized_text,
            PARALEGAL_CHUNK_MAX_TOKENS,
            weights=WEIGHTS,
            document_type=document_type,
        )
        token_counts = [c.get("tokenCount", 0) for c in paralegal_chunks]
        _doc_log(
            document_id,
            "coref_chunks",
            count=len(paralegal_chunks),
            maxTokens=PARALEGAL_CHUNK_MAX_TOKENS,
            maxChunkTokens=max(token_counts) if token_counts else 0,
            totalTokens=sum(token_counts),
        )

        if paralegal_chunks:
            try:
                # Persist chunks first (no vectors). API queues generate-embeddings separately.
                post_chunks(document_id, paralegal_chunks, normalized_text)
                chunks_posted = True
                _doc_log(
                    document_id,
                    "coref_chunks_posted",
                    count=len(paralegal_chunks),
                    note="chunks saved; embeddings queued asynchronously",
                )
            except Exception as e:
                _doc_log(document_id, "coref_failed", stage="post_chunks", error=str(e))
        else:
            _doc_log(document_id, "coref_chunks_empty", note="nothing to post")

        total_ms = int((time.time() - job_started) * 1000)
        _doc_log(
            document_id,
            "coref_job_complete",
            totalMs=total_ms,
            reused=reused_coref,
            participantsPosted=participants_posted,
            chunksPosted=chunks_posted,
        )
        return {"stored": True, "reused": reused_coref}

    except Exception as e:
        import traceback
        _doc_log(
            document_id,
            "coref_failed",
            error=str(e),
            ms=int((time.time() - job_started) * 1000),
            traceback=traceback.format_exc()[-800:],
        )
        raise


# Manual test job - commented out for production testing
# job = {
#     "data": {
#         "documentId": "75",
#         "textHash": "1234",
#     },
# }
async def main() -> None:
    global NLP, PATTERNS, TITLES, PARALEGAL_EXTRACTION_VERSION, WEIGHTS
    print("=" * 60)
    print("🚀 [COREF WORKER] Starting coreference worker")
    print("=" * 60)
    print(f"📝 [CONFIG] Queue name: {COREF_QUEUE_NAME}")
    print(f"📝 [CONFIG] Redis URL: {REDIS_URL}")
    print(f"📝 [CONFIG] Model architecture: {COREF_MODEL_ARCHITECTURE}")
    print(f"📝 [CONFIG] Coref max chars: {COREF_MAX_CHARS}")
    print(
        f"📝 [CONFIG] Paralegal chunk max tokens: {PARALEGAL_CHUNK_MAX_TOKENS} "
        f"(retrieval {_retrieval_tokens}, embed cap {EMBEDDING_MAX_TOKENS})"
    )
    print(f"📝 [CONFIG] API base URL: {API_BASE_URL}")
    print(f"📝 [CONFIG] Service token set: {bool(API_TOKEN)}")
    print(f"📝 [CONFIG] Extraction version: {PARALEGAL_EXTRACTION_VERSION}")
    print("=" * 60)
    
    print(f"🔧 [PIPELINE] Building pipeline with {COREF_MODEL_ARCHITECTURE} architecture")
    NLP = build_pipeline(model_architecture=COREF_MODEL_ARCHITECTURE)
    print(f"✅ [PIPELINE] Pipeline built successfully")

    patterns_path = Path(__file__).resolve().parent.parent / "patterns.yaml"
    titles_path = Path(__file__).resolve().parent.parent / "titles.yaml"
    weights_path = Path(__file__).resolve().parent.parent / "weights.yaml"

    print(f"📋 [CONFIG] Loading patterns from {patterns_path}")
    PATTERNS, yaml_version = load_patterns_config(patterns_path)
    if not _ENV_EXTRACTION_VERSION:
        PARALEGAL_EXTRACTION_VERSION = yaml_version
    print(f"📋 [CONFIG] Loaded {len(PATTERNS)} role patterns (extraction_version={PARALEGAL_EXTRACTION_VERSION})")

    print(f"📋 [CONFIG] Loading titles from {titles_path}")
    TITLES = load_titles(titles_path)
    prefixes = len(TITLES["prefixes"])
    suffixes = len(TITLES["suffixes"])
    print(f"📋 [CONFIG] Loaded {prefixes} title prefixes, {suffixes} title suffixes")

    print(f"📋 [CONFIG] Loading weights from {weights_path}")
    WEIGHTS = load_weights(weights_path)
    num_doc_types = len(WEIGHTS.get("per_document_type", {}))
    print(f"📋 [CONFIG] Loaded weights with {num_doc_types} document type overrides")

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
