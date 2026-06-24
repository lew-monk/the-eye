from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import semchunk
import tiktoken
import yaml


def load_patterns(path: Path | str) -> List[Dict[str, Any]]:
    with open(path) as f:
        data = yaml.safe_load(f)
    return data.get("roles", [])


def load_titles(path: Path | str) -> Dict[str, List[str]]:
    with open(path) as f:
        data = yaml.safe_load(f)
    return {
        "prefixes": sorted(
            (t.lower() for t in data.get("titles", [])), key=len, reverse=True
        ),
        "suffixes": sorted(
            (s.lower() for s in data.get("suffixes", [])), key=len, reverse=True
        ),
    }


def _normalize_name(name: str, titles: Dict[str, List[str]]) -> str:
    result = name.strip()
    for prefix in titles["prefixes"]:
        p = re.compile(r"^\s*" + re.escape(prefix) + r"\.?\s+", re.IGNORECASE)
        if p.match(result):
            result = p.sub("", result)
            break
    for suffix in titles["suffixes"]:
        p = re.compile(r"[,\s]+" + re.escape(suffix) + r"\.?\s*$", re.IGNORECASE)
        if p.search(result):
            result = p.sub("", result)
            break
    return result.strip() or name.strip()


def _strip_article(text: str) -> str:
    return re.sub(r"^(?:the|a|an)\s+", "", text, flags=re.IGNORECASE)


def _is_whole_word(text: str, start: int, end: int, matched: str) -> bool:
    if not matched.isalnum():
        return True
    if start > 0 and text[start - 1].isalnum():
        return False
    if end < len(text) and text[end].isalnum():
        return False
    return True


def _match_role(
    mention_texts: List[str],
    patterns: List[Dict[str, Any]],
) -> tuple[str, float, Optional[str]]:
    sorted_patterns = sorted(
        patterns, key=lambda p: p.get("weight", 0), reverse=True
    )
    for entry in sorted_patterns:
        role = entry["role"]
        weight = entry.get("weight", 0.3)
        ner_hint = entry.get("ner_hint")
        for regex_str in entry.get("patterns", []):
            compiled = re.compile(regex_str, re.IGNORECASE)
            for mention in mention_texts:
                stripped = _strip_article(mention)
                m = compiled.search(stripped)
                if m and _is_whole_word(
                    stripped, m.start(), m.end(), m.group()
                ):
                    return role, weight, ner_hint
    return "other", 0.0, None


def extract_participants(
    clusters: List[List[str]],
    mentions: List[Dict[str, Any]],
    resolved_text: str,
    patterns: List[Dict[str, Any]],
    titles: Dict[str, List[str]],
) -> List[Dict[str, Any]]:
    participants: List[Dict[str, Any]] = []
    total_mentions = max(len(mentions), 1)

    for cluster_id, cluster_texts in enumerate(clusters):
        cleaned = [t.strip() for t in cluster_texts if t.strip()]
        if not cleaned:
            continue

        unique_mentions = list(dict.fromkeys(cleaned))
        canonical_name = max(unique_mentions, key=len)
        role, role_confidence, entity_type = _match_role(
            unique_mentions, patterns
        )
        normalized_name = _normalize_name(canonical_name, titles)
        mention_count = len(unique_mentions)
        relevance_score = (mention_count / total_mentions) * role_confidence

        participant: Dict[str, Any] = {
            "name": canonical_name,
            "normalizedName": normalized_name,
            "role": role,
            "roleConfidence": round(role_confidence, 4),
            "mentionCount": mention_count,
            "mentions": unique_mentions,
            "clusterId": cluster_id,
            "relevanceScore": round(relevance_score, 4),
        }
        if entity_type is not None:
            participant["entityType"] = entity_type
        participants.append(participant)

    participants.sort(key=lambda p: p["relevanceScore"], reverse=True)
    return participants


def _word_bounded(escaped: str, text: str) -> str:
    if text and text[0].isalnum():
        escaped = r"\b" + escaped
    if text and text[-1].isalnum():
        escaped = escaped + r"\b"
    return escaped


def normalize_text(
    resolved_text: str,
    participants: List[Dict[str, Any]],
    mentions: List[Dict[str, Any]],
) -> str:
    mention_to_tag: Dict[str, str] = {}
    for p in participants:
        tag = p["role"].upper()
        if tag == "OTHER":
            tag = "PERSON"
        for m in p["mentions"]:
            mention_to_tag[m] = tag

    sorted_mentions = sorted(mention_to_tag.keys(), key=len, reverse=True)
    result = resolved_text

    for mention in sorted_mentions:
        tag = mention_to_tag[mention]
        pattern = re.compile(
            _word_bounded(re.escape(mention), mention), re.IGNORECASE
        )
        result = pattern.sub(f"[{tag}]", result)

    return result


_ENCODING: object = None


def _get_encoding() -> object:
    global _ENCODING
    if _ENCODING is None:
        _ENCODING = tiktoken.encoding_for_model("text-embedding-3-small")
    return _ENCODING


def _token_count(text: str) -> int:
    return len(_get_encoding().encode(text))


def chunk_text(
    text: str,
    max_tokens: int = 512,
) -> List[Dict[str, Any]]:
    if not text or not text.strip():
        return [{"chunkIndex": 0, "text": "", "tokenCount": 0}]

    raw_chunks = semchunk.chunk(
        text, chunk_size=max_tokens, token_counter=_token_count
    )

    return [
        {
            "chunkIndex": i,
            "text": c,
            "tokenCount": _token_count(c),
        }
        for i, c in enumerate(raw_chunks)
    ]
