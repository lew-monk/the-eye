from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

import spacy

try:
    import neuralcoref
except Exception:  # pragma: no cover
    neuralcoref = None


@dataclass
class CorefResult:
    resolved_text: str
    clusters: List[List[str]]
    mentions: List[Dict[str, Any]]


def _extract_clusters(doc) -> Tuple[List[List[str]], List[Dict[str, Any]]]:
    clusters: List[List[str]] = []
    mentions: List[Dict[str, Any]] = []

    if not getattr(doc._, "has_coref", False):
        return clusters, mentions

    for cluster in doc._.coref_clusters:
        cluster_mentions: List[str] = []
        for mention in cluster.mentions:
            cluster_mentions.append(mention.text)
            mentions.append({
                "text": mention.text,
                "start": mention.start,
                "end": mention.end,
                "cluster_id": cluster.i,
            })
        clusters.append(cluster_mentions)

    return clusters, mentions


def resolve_coref(nlp, text: str) -> CorefResult:
    doc = nlp(text)
    resolved_text = doc._.coref_resolved if getattr(
        doc._, "has_coref", False) else text
    clusters, mentions = _extract_clusters(doc)
    return CorefResult(resolved_text=resolved_text, clusters=clusters, mentions=mentions)


def build_pipeline() -> Any:
    nlp = spacy.load("en_core_web_sm")
    if neuralcoref is None:
        raise RuntimeError("neuralcoref is not available")

    neuralcoref.add_to_pipe(nlp)
    return nlp
