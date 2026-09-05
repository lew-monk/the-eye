from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

import spacy
from fastcoref import spacy_component

@dataclass
class CorefResult:
    resolved_text: str
    clusters: List[List[str]]
    mentions: List[Dict[str, Any]]


def _extract_clusters(doc) -> Tuple[List[List[str]], List[Dict[str, Any]]]:
    clusters: List[List[str]] = []
    mentions: List[Dict[str, Any]] = []

    if not hasattr(doc._, "coref_clusters") or not doc._.coref_clusters:
        return clusters, mentions

    for cluster_id, cluster in enumerate(doc._.coref_clusters):
        cluster_texts: List[str] = []
        for start, end in cluster:
            mention_text = doc.text[start:end]
            cluster_texts.append(mention_text)
            mentions.append({
                "text": mention_text,
                "start": start,
                "end": end,
                "cluster_id": cluster_id,
            })
        clusters.append(cluster_texts)

    return clusters, mentions


def resolve_coref(nlp, text: str) -> CorefResult:
    doc = nlp(text, component_cfg={"fastcoref": {"resolve_text": True}})
    resolved_text = doc._.resolved_text if hasattr(
        doc._, "resolved_text") else text
    clusters, mentions = _extract_clusters(doc)
    return CorefResult(resolved_text=resolved_text, clusters=clusters, mentions=mentions)


def build_pipeline(model_architecture: str = "FCoref") -> Any:
    nlp = spacy.load("en_core_web_sm", exclude=["parser", "lemmatizer", "textcat"])
    nlp.add_pipe("fastcoref", config={"model_architecture": model_architecture})
    return nlp
