import type { CaseNetworkEdge, CaseNetworkNode } from "#/integrations/trpc/routers/cases";

export type ScoredNode = CaseNetworkNode & {
	importance: number;
	relevanceToFocus: number;
	mentionNorm: number;
};

export function adjacency(edges: CaseNetworkEdge[]): Map<string, string[]> {
	const adj = new Map<string, string[]>();
	for (const e of edges) {
		const a = adj.get(e.source) ?? [];
		a.push(e.target);
		adj.set(e.source, a);
		const b = adj.get(e.target) ?? [];
		b.push(e.source);
		adj.set(e.target, b);
	}
	return adj;
}

export function connectionStrength(
	a: string,
	b: string,
	edges: CaseNetworkEdge[],
	adj?: Map<string, string[]>,
): number {
	if (a === b) return 1;
	const graph = adj ?? adjacency(edges);
	const next = graph.get(a) ?? [];
	if (next.includes(b)) {
		const kinds = edges
			.filter(
				(e) =>
					(e.source === a && e.target === b) || (e.source === b && e.target === a),
			)
			.map((e) => e.kind);
		if (kinds.includes("mentioned_in") || kinds.includes("has_entity")) return 0.92;
		if (kinds.includes("has_document") || kinds.includes("in_case")) return 0.8;
		if (kinds.includes("doc_ref") || kinds.includes("about")) return 0.74;
		if (kinds.includes("co_occurs")) return 0.55;
		return 0.7;
	}
	const fromA = new Set(next);
	for (const nb of graph.get(b) ?? []) {
		if (fromA.has(nb)) return 0.42;
	}
	return 0.08;
}

const CORE_CAPS: Record<string, number> = {
	entity: 8,
	document: 5,
	role: 4,
	case: 6,
	connected_case: 4,
	similar_case: 4,
	signal: 8,
};

export function degreeMap(edges: CaseNetworkEdge[]): Map<string, number> {
	const d = new Map<string, number>();
	for (const e of edges) {
		d.set(e.source, (d.get(e.source) ?? 0) + 1);
		d.set(e.target, (d.get(e.target) ?? 0) + 1);
	}
	return d;
}

export function scoreNodes(
	nodes: CaseNetworkNode[],
	edges: CaseNetworkEdge[],
	focusId?: string | null,
): ScoredNode[] {
	const degree = degreeMap(edges);
	const maxMentions = Math.max(1, ...nodes.map((n) => n.mentionCount ?? 0));
	const maxDocs = Math.max(1, ...nodes.map((n) => n.documentCount ?? 0));
	const maxDegree = Math.max(1, ...nodes.map((n) => degree.get(n.id) ?? 0));
	const maxWeight = Math.max(1, ...nodes.map((n) => n.weight ?? 0));
	const adj = adjacency(edges);

	return nodes.map((n) => {
		const deg = (degree.get(n.id) ?? 0) / maxDegree;
		const mentions = (n.mentionCount ?? 0) / maxMentions;
		const docs = (n.documentCount ?? 0) / maxDocs;
		const w = (n.weight ?? 0) / maxWeight;

		let importance = 0;
		if (n.id === focusId) {
			importance = 1;
		} else if (n.kind === "entity") {
			importance = mentions * 0.5 + docs * 0.25 + deg * 0.25;
		} else if (n.kind === "document") {
			importance = deg * 0.7 + w * 0.3;
		} else if (n.kind === "role") {
			importance = mentions * 0.65 + deg * 0.35;
		} else if (n.kind === "signal") {
			importance = 0.78 + deg * 0.15;
		} else if (n.kind === "case" || n.kind === "connected_case" || n.kind === "similar_case") {
			importance = 0.62 + deg * 0.2;
		} else {
			importance = w * 0.5 + deg * 0.5;
		}

		const relevanceToFocus = focusId
			? Math.max(
					0.06,
					Math.min(
						1,
						connectionStrength(n.id, focusId, edges, adj) * 0.78 + importance * 0.22,
					),
				)
			: importance;

		return {
			...n,
			importance: Math.max(0.06, Math.min(1, importance)),
			relevanceToFocus: n.id === focusId ? 1 : relevanceToFocus,
			mentionNorm: mentions,
		};
	});
}

export function filterCoreGraph(
	nodes: CaseNetworkNode[],
	edges: CaseNetworkEdge[],
	focusId?: string | null,
	opts?: { burst?: boolean; extraIds?: Iterable<string> },
): { nodes: ScoredNode[]; edges: CaseNetworkEdge[]; hidden: number } {
	const scored = scoreNodes(nodes, edges, focusId);
	if (opts?.burst || scored.length <= 12) {
		return { nodes: scored, edges, hidden: 0 };
	}

	const keep = new Set<string>();
	if (focusId) keep.add(focusId);

	const extra = new Set(opts?.extraIds ?? []);
	for (const id of extra) keep.add(id);

	const byKind = new Map<string, ScoredNode[]>();
	for (const n of scored) {
		const list = byKind.get(n.kind) ?? [];
		list.push(n);
		byKind.set(n.kind, list);
	}
	for (const [kind, list] of byKind) {
		const cap = CORE_CAPS[kind] ?? 6;
		const ranked = [...list].sort(
			(a, b) => b.relevanceToFocus - a.relevanceToFocus || b.importance - a.importance,
		);
		for (const n of ranked.slice(0, cap)) keep.add(n.id);
	}

	// Keep a path from focus to kept entities: their role + strongest document.
	const adj = new Map<string, string[]>();
	for (const e of edges) {
		const a = adj.get(e.source) ?? [];
		a.push(e.target);
		adj.set(e.source, a);
		const b = adj.get(e.target) ?? [];
		b.push(e.source);
		adj.set(e.target, b);
	}
	const byId = new Map(scored.map((n) => [n.id, n]));
	for (const n of scored) {
		if (!keep.has(n.id) || n.kind !== "entity") continue;
		const neighbors = adj.get(n.id) ?? [];
		const role = neighbors.map((id) => byId.get(id)).find((x) => x?.kind === "role");
		if (role) keep.add(role.id);
		const docs = neighbors
			.map((id) => byId.get(id))
			.filter((x): x is ScoredNode => x?.kind === "document")
			.sort((a, b) => b.importance - a.importance);
		if (docs[0]) keep.add(docs[0].id);
	}

	const keptNodes = scored.filter((n) => keep.has(n.id));
	const keptIds = new Set(keptNodes.map((n) => n.id));
	const quietKinds = new Set(["co_occurs"]);
	const keptEdges = edges.filter(
		(e) =>
			keptIds.has(e.source) &&
			keptIds.has(e.target) &&
			(opts?.burst || !quietKinds.has(e.kind)),
	);
	return {
		nodes: keptNodes,
		edges: keptEdges,
		hidden: Math.max(0, nodes.length - keptNodes.length),
	};
}
