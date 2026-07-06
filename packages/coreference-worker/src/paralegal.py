from __future__ import annotations

import re
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

import semchunk
import tiktoken
import yaml


PRONOUNS = {
    "i", "me", "my", "mine", "myself",
    "you", "your", "yours", "yourself",
    "he", "him", "his", "himself",
    "she", "her", "hers", "herself",
    "it", "its", "itself",
    "we", "us", "our", "ours", "ourselves",
    "they", "them", "their", "theirs", "themselves",
}

ENTITY_TYPE_MAP: Dict[str, str] = {
    "PERSON": "PERSON",
    "ORG": "ORG",
    "GPE": "LOCATION",
    "DATE": "DATE",
    "MONEY": "AMOUNT",
    "LAW": "STATUTE",
    "NORP": "GROUP",
    "LOC": "LOCATION",
    "PRODUCT": "PRODUCT",
    "EVENT": "EVENT",
    "FAC": "FACILITY",
}


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


def pick_canonical(mentions: List[str], nlp=None) -> str:
    cleaned = [m.strip() for m in mentions if m.strip()]
    if not cleaned:
        return ""

    non_pronouns = [m for m in cleaned if m.lower() not in PRONOUNS]

    if non_pronouns:
        return max(non_pronouns, key=len)

    if nlp is not None:
        for m in cleaned:
            doc = nlp(m)
            if doc.ents and doc.ents[0].label_ == "PERSON":
                return m

    freq = Counter(cleaned)
    return freq.most_common(1)[0][0]


def _normalize_name(
    name: str,
    titles: Dict[str, List[str]],
    matched_pattern: Optional[str] = None,
    matched_text: Optional[str] = None,
) -> str:
    result = name.strip()

    # 1. Strip the matched role text
    if matched_text:
        result = re.sub(
            re.escape(matched_text), "", result, flags=re.IGNORECASE
        ).strip()
    elif matched_pattern:
        result = re.sub(matched_pattern, "", result, flags=re.IGNORECASE).strip()

    # 2. Strip legal suffixes from titles.yaml
    for suffix in titles["suffixes"]:
        p = re.compile(r"[,\s]+" + re.escape(suffix) + r"\.?\s*$", re.IGNORECASE)
        if p.search(result):
            result = p.sub("", result)
            break

    # 3. Strip universal titles from titles.yaml (repeat until none match)
    changed = True
    while changed:
        changed = False
        for prefix in titles["prefixes"]:
            p = re.compile(r"^\s*" + re.escape(prefix) + r"\.?\s+", re.IGNORECASE)
            if p.match(result):
                result = p.sub("", result)
                changed = True
                break

    # 4. Strip initials (single uppercase letters with optional period, followed by space or end)
    result = re.sub(r"\b[A-Z]\.?(?:\s+|$)", "", result).strip()

    # 5. Strip punctuation, lowercase, normalize whitespace
    result = re.sub(r"[^\w\s-]", "", result)
    result = " ".join(result.lower().split())

    return result or name.strip().lower()


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
) -> tuple[str, float, Optional[str], Optional[str], Optional[str]]:
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
                    return role, weight, ner_hint, regex_str, m.group()
    return "other", 0.0, None, None, None


def _resolve_entity_type(
    canonical_name: str,
    ner_hint: Optional[str],
    nlp=None,
) -> Optional[str]:
    if nlp is not None:
        doc = nlp(canonical_name)
        if doc.ents:
            return doc.ents[0].label_
        if doc and doc[0].ent_type_:
            return doc[0].ent_type_
    return ner_hint


def _get_ner_tag(entity_type: Optional[str]) -> str:
    if entity_type is None:
        return "PERSON"
    return ENTITY_TYPE_MAP.get(entity_type, "PERSON")


def _has_position_boost(
    resolved_text: str,
    mentions: List[Dict[str, Any]],
    cluster_id: int,
) -> float:
    tenth = len(resolved_text) // 10
    for m in mentions:
        if m.get("cluster_id") == cluster_id:
            pos = m.get("start", 0)
            if pos < tenth or pos > len(resolved_text) - tenth:
                return 1.2
    return 1.0


def extract_participants(
    clusters: List[List[str]],
    mentions: List[Dict[str, Any]],
    resolved_text: str,
    patterns: List[Dict[str, Any]],
    titles: Dict[str, List[str]],
    nlp=None,
) -> List[Dict[str, Any]]:
    participants: List[Dict[str, Any]] = []

    # First pass: collect mention counts and cluster sizes
    cluster_data = []
    total_mention_counts = []
    for cluster_id, cluster_texts in enumerate(clusters):
        cleaned = [t.strip() for t in cluster_texts if t.strip()]
        if not cleaned:
            continue
        unique_mentions = list(dict.fromkeys(cleaned))
        total_mention_count = len(cleaned)
        cluster_data.append((cluster_id, unique_mentions))
        total_mention_counts.append(total_mention_count)

    if not cluster_data:
        return []

    max_mention_count = max(total_mention_counts)
    max_cluster_size = max(len(cd[1]) for cd in cluster_data)

    for idx, (cluster_id, unique_mentions) in enumerate(cluster_data):
        canonical_name = pick_canonical(unique_mentions, nlp)
        role, role_confidence, ner_hint, matched_pattern, matched_text = _match_role(
            unique_mentions, patterns
        )
        entity_type = _resolve_entity_type(canonical_name, ner_hint, nlp)
        normalized_name = _normalize_name(
            canonical_name, titles, matched_pattern, matched_text
        )

        total_mentions = total_mention_counts[idx]
        mention_freq_norm = total_mentions / max(max_mention_count, 1)
        cluster_size_norm = len(unique_mentions) / max(max_cluster_size, 1)
        position_weight = _has_position_boost(resolved_text, mentions, cluster_id)
        role_weight = role_confidence

        # 4-factor relevance scoring
        relevance_score = (
            0.3 * mention_freq_norm
            + 0.1 * position_weight
            + 0.15 * cluster_size_norm
            + 0.45 * role_weight
        )

        participant: Dict[str, Any] = {
            "name": canonical_name,
            "normalizedName": normalized_name,
            "role": role,
            "roleConfidence": round(role_confidence, 4),
            "entityType": entity_type,
            "mentionCount": total_mentions,
            "mentions": unique_mentions,
            "clusterId": cluster_id,
            "relevanceScore": round(relevance_score, 4),
        }
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
            tag = _get_ner_tag(p.get("entityType"))
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
