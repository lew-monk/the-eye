from __future__ import annotations

import hashlib
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


def load_patterns_config(path: Path | str) -> tuple[List[Dict[str, Any]], int]:
    with open(path) as f:
        data = yaml.safe_load(f) or {}
    version = int(data.get("version") or 1)
    return data.get("roles", []), version


def load_patterns(path: Path | str) -> List[Dict[str, Any]]:
    roles, _ = load_patterns_config(path)
    return roles


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


def _parse_weight_key(key: str) -> tuple[int, bool]:
    match = re.match(r"chunk_(\d+)(\+)?$", key)
    if match:
        return int(match.group(1)), bool(match.group(2))
    return 0, False


def _resolve_weight(
    weights: Dict[str, float], chunk_index: int, section: Optional[str] = None
) -> float:
    if section:
        section_key = f"section_{_normalize_section(section)}"
        if section_key in weights:
            return weights[section_key]
    exact_key = f"chunk_{chunk_index}"
    if exact_key in weights:
        return weights[exact_key]
    fallback_keys = sorted(
        (k for k in weights if k.endswith("+")),
        key=lambda k: _parse_weight_key(k)[0],
        reverse=True,
    )
    for key in fallback_keys:
        threshold, _ = _parse_weight_key(key)
        if chunk_index >= threshold:
            return weights[key]
    return 1.0


def load_weights(path: Path | str) -> Dict[str, Any]:
    with open(path) as f:
        data = yaml.safe_load(f)
    return {
        "default": data.get("default", {}),
        "per_document_type": data.get("per_document_type", {}),
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
    return ner_hint or "other"


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


HEADROOM_FACTOR: float = 0.9


def _chunk_row(
    chunk_index: int,
    text: str,
    position_weight: float,
    parent_chunk_index: Optional[int] = None,
    section: Optional[str] = None,
    chunk_uid: Optional[str] = None,
) -> Dict[str, Any]:
    row: Dict[str, Any] = {
        "chunkIndex": chunk_index,
        "text": text,
        "tokenCount": _token_count(text),
        "positionWeight": position_weight,
        "chunkTextHash": hashlib.sha256(text.encode("utf-8")).hexdigest(),
    }
    if parent_chunk_index is not None:
        row["parentChunkIndex"] = parent_chunk_index
    if section is not None:
        row["section"] = section
    if chunk_uid is not None:
        row["chunkUid"] = chunk_uid
    return row


OVERLAP_RATIO: float = 0.15
CHUNKER_VERSION: int = 1


def _normalize_section(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (name or "").strip().lower()).strip("_")
    return slug[:80]


def _normalize_heading_line(line: str) -> str:
    text = re.sub(r"^#{1,6}\s+", "", line.strip()).strip()
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("*", "").replace("_", "")
    return re.sub(r"\s+", " ", text).strip().casefold()


def _split_sections(
    text: str, section_headings: Optional[List[str]]
) -> List[tuple[str, str]]:
    """Split text on heading matches. Returns [(section_label, body)].

    Headings match in order, first occurrence at/after the cursor, compared
    whitespace- and case-insensitively with markdown `#` prefixes tolerated on
    either side. Unmatched headings are ignored; text before the first match
    becomes the ("", preamble) section. Empty input yields [].
    """
    if not text or not text.strip():
        return []
    if not section_headings:
        return [("", text)]
    wanted = [(h, _normalize_heading_line(h)) for h in section_headings]
    wanted = [(h, n) for h, n in wanted if n]
    if not wanted:
        return [("", text)]

    lines = text.splitlines(keepends=True)
    norm_lines = [_normalize_heading_line(l) for l in lines]
    boundaries: list[tuple[int, str]] = []
    cursor = 0
    for original, norm in wanted:
        found = -1
        for i in range(cursor, len(lines)):
            if norm_lines[i] == norm:
                found = i
                break
        if found == -1:
            continue
        boundaries.append((found, original.strip()))
        cursor = found + 1

    if not boundaries:
        return [("", text)]
    sections: list[tuple[str, str]] = []
    first_line, _ = boundaries[0]
    if first_line > 0:
        sections.append(("", "".join(lines[:first_line])))
    for idx, (line_no, label) in enumerate(boundaries):
        end = boundaries[idx + 1][0] if idx + 1 < len(boundaries) else len(lines)
        sections.append((label, "".join(lines[line_no:end])))
    return [(label, body) for label, body in sections if body.strip()]


def _is_table_line(line: str) -> bool:
    return line.strip().startswith("|")


def _split_tables(paragraphs: List[str]) -> List[tuple[str, str]]:
    """Group paragraphs into ("table"|"prose", text). A table is a run of
    pipe-leading lines; it must stay atomic (one chunk, never overlapped)."""
    groups: list[tuple[str, str]] = []
    current: List[str] = []
    current_kind = "prose"
    for para in paragraphs:
        stripped = para.strip()
        if not stripped:
            continue
        lines = [ln for ln in stripped.splitlines() if ln.strip()]
        kind = "table" if lines and all(_is_table_line(ln) for ln in lines) else "prose"
        if kind == current_kind:
            current.append(stripped)
        else:
            if current:
                groups.append((current_kind, "\n\n".join(current)))
            current = [stripped]
            current_kind = kind
    if current:
        groups.append((current_kind, "\n\n".join(current)))
    return groups


def _overlap_tail(text: str, max_tokens: int) -> str:
    if max_tokens <= 0 or not text.strip():
        return ""
    ids = _get_encoding().encode(text)  # type: ignore[union-attr]
    tail = ids[-max_tokens:]
    return _get_encoding().decode(tail)  # type: ignore[union-attr]


def _chunk_uid(
    document_id: Optional[int], section: str, text_hash: str, chunker_version: int
) -> Optional[str]:
    if document_id is None:
        return None
    payload = f"{document_id}|{_normalize_section(section)}|{text_hash}|{chunker_version}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _paragraph_chunk(text: str, max_tokens: int) -> List[str]:
    paragraphs = re.split(r"\n\n+", text)
    chunks: List[str] = []
    current: List[str] = []
    current_tokens: int = 0

    for para in paragraphs:
        stripped = para.strip()
        if not stripped:
            continue
        para_tokens = _token_count(stripped)

        if para_tokens > max_tokens:
            if current:
                chunks.append("\n\n".join(current))
                current = []
                current_tokens = 0
            chunks.extend(semchunk.chunk(stripped, chunk_size=max_tokens, token_counter=_token_count))
        elif current_tokens + para_tokens <= max_tokens:
            current.append(stripped)
            current_tokens += para_tokens
        else:
            chunks.append("\n\n".join(current))
            current = [stripped]
            current_tokens = para_tokens

    if current:
        chunks.append("\n\n".join(current))

    return chunks


def chunk_text(
    text: str,
    max_tokens: int = 512,
    weights: Optional[Dict[str, Any]] = None,
    document_type: Optional[str] = None,
    parent_max_tokens: Optional[int] = None,
    section_headings: Optional[List[str]] = None,
    document_id: Optional[int] = None,
    chunker_version: int = CHUNKER_VERSION,
) -> List[Dict[str, Any]]:
    if not text or not text.strip():
        return [_chunk_row(0, "", 1.0)]

    retrieval_max = max(1, int(max_tokens * HEADROOM_FACTOR))
    parent_cap = retrieval_max
    if parent_max_tokens is not None:
        parent_cap = max(retrieval_max, int(parent_max_tokens * HEADROOM_FACTOR))
    overlap_tokens = max(0, int(retrieval_max * OVERLAP_RATIO))

    type_weights: Dict[str, float] = {}
    if weights:
        doc_weights = weights.get("per_document_type", {}).get(document_type or "")
        if doc_weights:
            type_weights = doc_weights
        else:
            type_weights = weights.get("default", {})

    sections = _split_sections(text, section_headings)
    if not sections:
        return [_chunk_row(0, "", 1.0)]

    # Legacy path (no headings): byte-identical behavior to before —
    # paragraph windows, positional weights, no overlap, no section labels.
    if section_headings is None:
        chunks: List[Dict[str, Any]] = []
        chunk_index = 0
        for section_index, parent_text in enumerate(_paragraph_chunk(text, parent_cap)):
            children = _paragraph_chunk(parent_text, retrieval_max)
            weight = _resolve_weight(type_weights, section_index)
            if len(children) <= 1:
                leaf = children[0] if children else parent_text
                chunks.append(_chunk_row(chunk_index, leaf, weight))
                chunk_index += 1
                continue
            parent_index = chunk_index
            chunks.append(_chunk_row(parent_index, parent_text, weight))
            chunk_index += 1
            for child in children:
                chunks.append(_chunk_row(chunk_index, child, weight, parent_index))
                chunk_index += 1
        return chunks

    chunks = []
    chunk_index = 0

    def emit(index: int, body: str, weight: float, section: str,
             parent: Optional[int] = None) -> Dict[str, Any]:
        text_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
        uid = _chunk_uid(document_id, section, text_hash, chunker_version)
        return _chunk_row(index, body, weight, parent, section, uid)

    for section_label, section_body in sections:
        groups = _split_tables(re.split(r"\n\n+", section_body))
        section_position = 0
        for kind, group_text in groups:
            if kind == "table":
                # Atomic: one chunk, never split, never overlapped in/out.
                weight = _resolve_weight(type_weights, section_position, section_label)
                chunks.append(emit(chunk_index, group_text, weight, section_label))
                chunk_index += 1
                section_position += 1
                continue
            parent_windows = _paragraph_chunk(group_text, parent_cap)
            for parent_text in parent_windows:
                children = _paragraph_chunk(parent_text, retrieval_max)
                weight = _resolve_weight(type_weights, section_position, section_label)
                if len(children) <= 1:
                    leaf = children[0] if children else parent_text
                    chunks.append(emit(chunk_index, leaf, weight, section_label))
                    chunk_index += 1
                    section_position += 1
                    continue
                parent_index = chunk_index
                chunks.append(emit(parent_index, parent_text, weight, section_label))
                chunk_index += 1
                previous_child: Optional[str] = None
                for child in children:
                    body = child
                    if previous_child is not None and overlap_tokens > 0:
                        tail = _overlap_tail(previous_child, overlap_tokens)
                        if tail:
                            body = f"{tail}\n{child}"
                    chunks.append(emit(chunk_index, body, weight, section_label, parent_index))
                    chunk_index += 1
                    section_position += 1
                    previous_child = child

    return chunks
