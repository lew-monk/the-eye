import type { CaseNetworkNode } from "#/integrations/trpc/routers/cases";

export type LaidOutNode = CaseNetworkNode & {
	gx: number;
	gy: number;
	w: number;
	d: number;
	h: number;
	importance: number;
	relevanceToFocus: number;
	mentionNorm: number;
};

const GOLDEN = 2.399963229728653;

function sizeFor(n: CaseNetworkNode & { mentionNorm?: number; importance?: number }, isPin: boolean) {
	const m = n.mentionNorm ?? n.importance ?? 0.3;
	if (isPin) {
		return { w: 2.4, d: 2.4, h: 2.8 + m * 1.4 };
	}
	if (n.kind === "document") {
		return { w: 1.5 + m * 0.8, d: 1.7 + m * 0.7, h: 0.45 + m * 0.55 };
	}
	if (n.kind === "case" || n.kind === "connected_case" || n.kind === "similar_case") {
		return { w: 1.15 + m * 0.5, d: 1.15 + m * 0.5, h: 1.8 + m * 1.6 };
	}
	if (n.kind === "role") {
		return { w: 1.1 + m * 0.5, d: 1.1 + m * 0.5, h: 1.1 + m * 0.9 };
	}
	return { w: 0.95 + m * 1.15, d: 0.95 + m * 1.15, h: 0.8 + m * 2.4 };
}

export function layoutNodes(
	nodes: (CaseNetworkNode & {
		importance?: number;
		relevanceToFocus?: number;
		mentionNorm?: number;
	})[],
	focusId?: string | null,
	angleOverride?: Record<string, number>,
): LaidOutNode[] {
	const pin =
		nodes.find((n) => n.id === focusId) ??
		nodes.find((n) => n.kind === "case") ??
		nodes[0];
	if (!pin) return [];

	const pinImp = pin.importance ?? 1;
	const pinRel = pin.relevanceToFocus ?? 1;
	const pinMention = pin.mentionNorm ?? 1;
	const pinSize = sizeFor({ ...pin, mentionNorm: pinMention, importance: pinImp }, true);
	const out: LaidOutNode[] = [
		{
			...pin,
			importance: pinImp,
			relevanceToFocus: pinRel,
			mentionNorm: pinMention,
			gx: 0,
			gy: 0,
			...pinSize,
		},
	];

	const others = nodes
		.filter((n) => n.id !== pin.id)
		.sort((a, b) => (b.relevanceToFocus ?? 0) - (a.relevanceToFocus ?? 0));

	others.forEach((n, i) => {
		const rel = n.relevanceToFocus ?? n.importance ?? 0.2;
		const radius = 2.35 + (1 - rel) * 9.2;
		const theta = angleOverride?.[n.id] ?? i * GOLDEN;
		const size = sizeFor(n, false);
		out.push({
			...n,
			importance: n.importance ?? 0.3,
			relevanceToFocus: rel,
			mentionNorm: n.mentionNorm ?? 0.3,
			gx: Math.cos(theta) * radius,
			gy: Math.sin(theta) * radius,
			...size,
		});
	});

	return out;
}

export function targetRadius(relevanceToFocus: number) {
	return 2.35 + (1 - relevanceToFocus) * 9.2;
}
