import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button, StatusChip, StatusDot } from "@workspace/ui";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "#/components/app-shell";
import { IsoNetworkScene } from "#/components/iso-network";
import { filterCoreGraph } from "#/components/graph-relevance";
import { useTRPC } from "#/integrations/trpc/react";
import type {
	CaseData,
	CaseNetworkData,
	CaseNetworkEdge,
	CaseNetworkNode,
	CaseRelationData,
	NetworkFocusType,
} from "#/integrations/trpc/routers/cases";

type NetworkSearch = {
	caseId?: number;
	focus?: string;
};

type FocusInput = {
	type: NetworkFocusType;
	id: string;
	caseId?: number;
};

type Crumb = { focus: string; label: string };

export const Route = createFileRoute("/network")({
	validateSearch: (search: Record<string, unknown>): NetworkSearch => {
		const raw = search.caseId;
		const n = typeof raw === "string" || typeof raw === "number" ? Number(raw) : Number.NaN;
		const focus = typeof search.focus === "string" ? search.focus : undefined;
		return {
			...(Number.isFinite(n) ? { caseId: n } : {}),
			...(focus ? { focus } : {}),
		};
	},
	component: NetworkPage,
});

function encodeFocus(focus: FocusInput): string {
	const prefix = focus.type === "document" ? "doc" : focus.type;
	return `${prefix}:${focus.id}`;
}

function parseFocus(raw: string | undefined, caseId?: number): FocusInput | null {
	if (raw) {
		const split = raw.indexOf(":");
		if (split > 0) {
			const type = raw.slice(0, split);
			const id = raw.slice(split + 1);
			if (id && (type === "case" || type === "entity" || type === "role")) {
				return { type, id, caseId };
			}
			if (id && (type === "document" || type === "doc")) {
				return { type: "document", id, caseId };
			}
		}
	}
	if (caseId != null) return { type: "case", id: String(caseId), caseId };
	return null;
}

function nodeToFocus(node: CaseNetworkNode, fallbackCaseId?: number): FocusInput | null {
	if ((node.kind === "case" || node.kind === "connected_case") && node.caseId != null) {
		return { type: "case", id: String(node.caseId), caseId: node.caseId };
	}
	if (node.kind === "entity" && node.normalizedName) {
		return { type: "entity", id: node.normalizedName, caseId: node.caseId ?? fallbackCaseId };
	}
	if (node.kind === "document" && node.documentId != null) {
		return { type: "document", id: String(node.documentId), caseId: node.caseId ?? fallbackCaseId };
	}
	if (node.kind === "role" && node.role) {
		return { type: "role", id: node.role, caseId: fallbackCaseId };
	}
	return null;
}

function unionGraph(
	base: { nodes: CaseNetworkNode[]; edges: CaseNetworkEdge[] },
	extra: { nodes: CaseNetworkNode[]; edges: CaseNetworkEdge[] },
) {
	const nodes = [...base.nodes];
	for (const n of extra.nodes) {
		if (!nodes.some((x) => x.id === n.id)) nodes.push(n);
	}
	const edges = [...base.edges];
	for (const e of extra.edges) {
		if (!edges.some((x) => x.source === e.source && x.target === e.target && x.kind === e.kind)) {
			edges.push(e);
		}
	}
	return { nodes, edges };
}

const ROLE_LABELS: Record<string, string> = {
	judge: "JUDGE",
	lawyer: "COUNSEL",
	police: "LAW_ENFORCEMENT",
	witness: "WITNESS",
	prosecution: "PROSECUTION",
	magistrate: "MAGISTRATE",
	defendant: "DEFENDANT",
	plaintiff: "PLAINTIFF",
	prosecutor: "PROSECUTOR",
	court: "COURT",
	other: "OTHER",
};

function roleLabel(role: string) {
	return ROLE_LABELS[role] ?? role.toUpperCase().replace(/_/g, "_");
}

function kindLetter(kind: string) {
	if (kind === "case" || kind === "connected_case") return "C";
	if (kind === "role") return "R";
	if (kind === "document") return "D";
	return "N";
}

function NetworkPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/network" });
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [tab, setTab] = useState<"what" | "links">("what");
	const [trail, setTrail] = useState<Crumb[]>([]);
	const [working, setWorking] = useState<{ nodes: CaseNetworkNode[]; edges: CaseNetworkEdge[] }>({
		nodes: [],
		edges: [],
	});
	const [expanding, setExpanding] = useState(false);
	const [burst, setBurst] = useState(false);
	const [burstIds, setBurstIds] = useState<string[]>([]);
	const [viewMode, setViewMode] = useState<"board" | "list">("board");

	const { data: cases = [] } = useQuery({
		...trpc.cases.list.queryOptions(),
		staleTime: 30_000,
	});

	const activeFocus = parseFocus(search.focus, search.caseId ?? cases[0]?.id);

	useEffect(() => {
		if (search.focus || search.caseId || !cases[0]) return;
		void navigate({
			search: { caseId: cases[0].id, focus: `case:${cases[0].id}` },
			replace: true,
		});
	}, [search.focus, search.caseId, cases, navigate]);

	const { data: network, isLoading } = useQuery({
		...trpc.cases.getFocusNetwork.queryOptions({
			type: activeFocus?.type ?? "case",
			id: activeFocus?.id ?? "0",
			caseId: activeFocus?.caseId,
		}),
		enabled: activeFocus != null,
	});

	const relationCaseId =
		activeFocus?.type === "case" ? Number(activeFocus.id) : activeFocus?.caseId;
	const { data: relations = [] } = useQuery({
		...trpc.cases.getCaseRelations.queryOptions({ caseId: relationCaseId ?? 0 }),
		enabled: relationCaseId != null && !Number.isNaN(relationCaseId),
	});

	const selectedEntityName =
		selectedId?.startsWith("entity:") ? selectedId.slice("entity:".length) : undefined;
	const { data: mentionContexts = [] } = useQuery({
		...trpc.cases.getEntityMentionContexts.queryOptions({
			normalizedName: selectedEntityName ?? "",
			caseId: relationCaseId ?? 0,
		}),
		enabled: Boolean(selectedEntityName) && relationCaseId != null && !Number.isNaN(relationCaseId),
	});

	useEffect(() => {
		setSelectedId(network?.focusId ?? null);
		setTab("what");
		setBurst(false);
		setBurstIds([]);
	}, [network?.focusId]);

	const fullGraph = useMemo(() => {
		const merged = mergeConnectedCases(network, relations);
		return unionGraph(merged, working);
	}, [network, relations, working]);

	const graph = useMemo(() => {
		return filterCoreGraph(
			fullGraph.nodes,
			fullGraph.edges,
			selectedId ?? network?.focusId,
			{
				burst,
				extraIds: [...burstIds, ...(network?.focusId ? [network.focusId] : [])],
			},
		);
	}, [fullGraph, network?.focusId, selectedId, burst, burstIds]);

	const selected = graph.nodes.find((n) => n.id === selectedId) ?? fullGraph.nodes.find((n) => n.id === selectedId) ?? null;

	const grouped = useMemo(() => {
		return {
			case: graph.nodes.filter((n) => n.kind === "case"),
			roles: graph.nodes.filter((n) => n.kind === "role"),
			documents: graph.nodes.filter((n) => n.kind === "document"),
			entities: graph.nodes
				.filter((n) => n.kind === "entity")
				.sort((a, b) => ("importance" in b ? Number(b.importance) : 0) - ("importance" in a ? Number(a.importance) : 0)),
			connected: graph.nodes.filter((n) => n.kind === "connected_case"),
		};
	}, [graph.nodes]);

	const neighbors = useMemo(() => {
		if (!selected) return [];
		const ids = new Set<string>();
		for (const e of fullGraph.edges) {
			if (e.source === selected.id) ids.add(e.target);
			if (e.target === selected.id) ids.add(e.source);
		}
		return fullGraph.nodes.filter((n) => ids.has(n.id));
	}, [fullGraph, selected]);

	const burstSelected = () => {
		if (!selected) return;
		const ids = new Set<string>([selected.id, ...neighbors.map((n) => n.id)]);
		setBurstIds((prev) => [...new Set([...prev, ...ids])]);
	};

	const goToFocus = (focus: FocusInput, pushTrail = false) => {
		if (pushTrail && activeFocus && network) {
			setTrail((t) => [...t, { focus: encodeFocus(activeFocus), label: network.title || network.caseNumber || encodeFocus(activeFocus) }]);
		}
		void navigate({
			search: {
				focus: encodeFocus(focus),
				caseId: focus.type === "case" ? Number(focus.id) : focus.caseId,
			},
		});
	};

	const goInside = (node: CaseNetworkNode) => {
		const focus = nodeToFocus(node, activeFocus?.caseId);
		if (!focus) return;
		if (activeFocus && encodeFocus(focus) === encodeFocus(activeFocus)) return;
		goToFocus(focus, true);
	};

	const comeBack = () => {
		const prev = trail[trail.length - 1];
		if (!prev) return;
		setTrail((t) => t.slice(0, -1));
		const parsed = parseFocus(prev.focus, search.caseId);
		if (parsed) goToFocus(parsed, false);
	};

	const expandNode = async (node: CaseNetworkNode) => {
		const focus = nodeToFocus(node, activeFocus?.caseId);
		if (!focus) return;
		setExpanding(true);
		try {
			const extra = await queryClient.fetchQuery(
				trpc.cases.getFocusNetwork.queryOptions({
					type: focus.type,
					id: focus.id,
					caseId: focus.caseId,
				}),
			);
			if (extra) setWorking((w) => unionGraph(w, extra));
		} finally {
			setExpanding(false);
		}
	};

	const selectCase = (id: number) => {
		setTrail([]);
		setWorking({ nodes: [], edges: [] });
		goToFocus({ type: "case", id: String(id), caseId: id }, false);
	};

	return (
		<AppShell>
			<div className="h-[calc(100vh-5rem)] flex flex-col min-h-0">
				<header className="shrink-0 min-h-11 border-b border-outline-variant/30 px-4 py-1.5 flex items-center gap-4 overflow-x-auto">
					<div className="flex items-center gap-2 min-w-0">
						{trail.length > 0 && (
							<Button variant="ghost" size="sm" brackets={false} className="text-meta shrink-0" onClick={comeBack}>
								← OUT
							</Button>
						)}
						<div className="min-w-0">
							<div className="flex items-center gap-1.5 font-mono text-meta text-outline flex-wrap">
								{trail.map((c) => (
									<span key={c.focus} className="truncate max-w-[140px]">
										{c.label}
										<span className="mx-1">/</span>
									</span>
								))}
								<span className="text-on-surface uppercase tracking-[0.12em]">
									{network?.caseNumber ?? "BOARD"}
									{selected ? ` → ${selected.label}` : ""}
								</span>
							</div>
							<div className="flex items-baseline gap-2 min-w-0">
								<span className="font-mono text-body-lg font-bold tabular-nums text-on-surface shrink-0">
									{network?.title || network?.caseNumber || "NETWORK"}
								</span>
								{working.nodes.length > 0 && (
									<span className="font-mono text-meta text-primary/70">
										WORKING +{working.nodes.length}
									</span>
								)}
							</div>
						</div>
					</div>
					<div className="hidden md:flex items-center gap-5 ml-auto">
						<Stat label="SHOWN" value={graph.nodes.length} />
						<Stat label="HIDDEN" value={graph.hidden} />
						<Stat label="CONNECTIONS" value={graph.edges.length} />
						<Button
							variant={viewMode === "list" ? "default" : "ghost"}
							size="sm"
							brackets={false}
							className="text-meta"
							onClick={() => setViewMode((m) => (m === "board" ? "list" : "board"))}
						>
							{viewMode === "board" ? "LIST_VIEW" : "BOARD_VIEW"}
						</Button>
						<Button
							variant={burst ? "default" : "ghost"}
							size="sm"
							brackets={false}
							className="text-meta"
							onClick={() => setBurst((v) => !v)}
						>
							{burst ? "CORE_VIEW" : "BURST_ALL"}
						</Button>
						{selected && !burst && (
							<Button
								variant="ghost"
								size="sm"
								brackets={false}
								className="text-meta text-primary/70"
								onClick={burstSelected}
							>
								BURST_NODE
							</Button>
						)}
						{working.nodes.length > 0 && (
							<Button
								variant="ghost"
								size="sm"
								brackets={false}
								className="text-meta"
								onClick={() => setWorking({ nodes: [], edges: [] })}
							>
								RESET_WORKING
							</Button>
						)}
					</div>
				</header>

				<div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
					<aside className="min-h-0 overflow-y-auto border-r border-outline-variant/30 bg-surface">
						<Section title="CASES ON THE BOARD" count={grouped.case.length + grouped.connected.length}>
							{[...grouped.case, ...grouped.connected].map((n) => (
								<LegendRow
									key={n.id}
									letter="C"
									label={n.label}
									meta={n.sublabel}
									active={selectedId === n.id}
									onClick={() => setSelectedId(n.id)}
									onDoubleClick={() => goInside(n)}
								/>
							))}
						</Section>

						<Section title="ALL CASES" count={cases.length}>
							{cases.map((c) => (
								<LegendRow
									key={c.id}
									letter="C"
									label={c.caseNumber}
									meta={c.title}
									active={activeFocus?.type === "case" && activeFocus.id === String(c.id)}
									onClick={() => selectCase(c.id)}
								/>
							))}
						</Section>

						<Section title="ROLES" count={grouped.roles.length}>
							{grouped.roles.map((n) => (
								<LegendRow
									key={n.id}
									letter="R"
									label={roleLabel(n.role ?? n.label)}
									count={n.mentionCount}
									active={selectedId === n.id}
									onClick={() => setSelectedId(n.id)}
									onDoubleClick={() => goInside(n)}
								/>
							))}
						</Section>

						<Section title="DOCUMENTS" count={grouped.documents.length}>
							{grouped.documents.map((n) => (
								<LegendRow
									key={n.id}
									letter="D"
									label={n.label}
									meta={n.sublabel}
									active={selectedId === n.id}
									onClick={() => setSelectedId(n.id)}
									onDoubleClick={() => goInside(n)}
								/>
							))}
						</Section>

						<Section title="ENTITIES" count={network?.totals.entities ?? grouped.entities.length}>
							{grouped.entities.map((n) => (
								<LegendRow
									key={n.id}
									letter="N"
									label={n.label}
									meta={roleLabel(n.role ?? "other")}
									count={n.mentionCount}
									active={selectedId === n.id}
									onClick={() => setSelectedId(n.id)}
									onDoubleClick={() => goInside(n)}
								/>
							))}
							{graph.hidden > 0 && !burst && (
								<Button
									variant="ghost"
									size="sm"
									brackets={false}
									className="w-full text-meta text-primary/70 border-t border-outline-variant/10"
									onClick={() => setBurst(true)}
								>
									BURST +{graph.hidden} HIDDEN
								</Button>
							)}
						</Section>

					</aside>

					<main className="min-h-[55vh] lg:min-h-0 min-w-0 relative">
						{!activeFocus ? (
							<div className="h-full flex items-center justify-center">
								<span className="font-mono text-body text-outline">NO_CASES</span>
							</div>
						) : isLoading || !network ? (
							<div className="h-full flex items-center justify-center gap-2">
								<StatusDot variant="muted" size="md" pulse />
								<span className="font-mono text-body text-outline">LOADING_NETWORK</span>
							</div>
						) : viewMode === "list" ? (
							<div className="h-full overflow-y-auto p-4 space-y-1">
								{graph.nodes
									.slice()
									.sort(
										(a, b) =>
											(b.relevanceToFocus ?? b.importance ?? 0) -
											(a.relevanceToFocus ?? a.importance ?? 0),
									)
									.map((n) => (
										<button
											key={n.id}
											type="button"
											onClick={() => setSelectedId(n.id)}
											className={`w-full text-left px-3 py-2 border-l-2 ${
												selectedId === n.id
													? "border-primary bg-primary/[0.06]"
													: "border-transparent hover:bg-surface-container-high"
											}`}
										>
											<div className="font-mono text-body text-on-surface">{n.label}</div>
											<div className="font-mono text-meta text-outline">
												{n.kind === "entity"
													? "Person / entity"
													: n.kind === "document"
														? "Document"
														: n.kind === "case"
															? "Case"
															: n.kind.replace(/_/g, " ")}
												{" · "}
												relevance {Math.round((n.relevanceToFocus ?? n.importance ?? 0) * 100)}
											</div>
										</button>
									))}
							</div>
						) : (
							<IsoNetworkScene
								nodes={graph.nodes}
								edges={graph.edges}
								selectedId={selectedId}
								focusId={network.focusId}
								onSelect={setSelectedId}
								onEnter={goInside}
								catalog={fullGraph.nodes}
								onAdd={(id) => setBurstIds((prev) => [...new Set([...prev, id])])}
							/>
						)}
					</main>

					<aside className="min-h-0 overflow-y-auto border-l border-outline-variant/30 bg-surface flex flex-col">
						<div className="flex border-b border-outline-variant/30">
							<Button
								variant="ghost"
								size="sm"
								brackets={false}
								className={`flex-1 rounded-none text-meta ${
									tab === "what" ? "bg-on-surface text-background" : "text-outline"
								}`}
								onClick={() => setTab("what")}
							>
								ENTITY
							</Button>
							<Button
								variant="ghost"
								size="sm"
								brackets={false}
								className={`flex-1 rounded-none text-meta ${
									tab === "links" ? "bg-on-surface text-background" : "text-outline"
								}`}
								onClick={() => setTab("links")}
							>
								CONNECTIONS
							</Button>
						</div>

						<div className="p-5 flex-1">
							{!selected ? (
								<p className="font-mono text-body text-outline reading">
									Pin an entity on the board. Distance is how tightly it connects to
									what you are inspecting. Bigger means mentioned more often.
								</p>
							) : tab === "what" ? (
								<WhatThisIs
									node={selected}
									network={network}
									activeCase={cases.find((c) => c.id === relationCaseId)}
									relations={relations}
									isFocus={selected.id === network?.focusId}
									expanding={expanding}
									onEnter={() => goInside(selected)}
									onExpand={() => void expandNode(selected)}
									onBurst={burstSelected}
								/>
							) : (
								<div className="space-y-1">
									<div className="font-mono text-meta uppercase tracking-[0.12em] text-outline mb-2">
										{neighbors.length} LINKED
									</div>
									{neighbors.length === 0 ? (
										<p className="font-mono text-body text-outline">No connections on this entity.</p>
									) : (
										neighbors.map((n) => (
											<LegendRow
												key={n.id}
												letter={kindLetter(n.kind)}
												label={n.label}
												meta={n.kind.replace(/_/g, " ")}
												onClick={() => {
													setSelectedId(n.id);
													if (!graph.nodes.some((x) => x.id === n.id) && selected) {
														setBurstIds((prev) => [
															...new Set([...prev, n.id, selected.id]),
														]);
													}
												}}
											/>
										))
									)}
								</div>
							)}
							{mentionContexts.length > 0 && (
								<div className="mt-4 pt-4 border-t border-outline-variant/20 space-y-3">
									<div className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
										WHY THIS CONNECTION
									</div>
									{mentionContexts.slice(0, 5).map((m, i) => {
										const raw = (m.context || m.text || "").replace(/\s+/g, " ").trim();
										const excerpt =
											raw.length > 280 ? `${raw.slice(0, 280).trim()}…` : raw;
										return (
											<div key={`${m.start}-${i}`}>
												{m.filename && (
													<div className="font-mono text-meta text-outline truncate mb-1">
														{m.filename}
													</div>
												)}
												<p className="font-mono text-body text-on-surface reading">
													{excerpt}
												</p>
											</div>
										);
									})}
								</div>
							)}
						</div>
					</aside>
				</div>
			</div>
		</AppShell>
	);
}

function mergeConnectedCases(
	network: CaseNetworkData | null | undefined,
	relations: CaseRelationData[],
): { nodes: CaseNetworkNode[]; edges: CaseNetworkEdge[] } {
	if (!network) return { nodes: [], edges: [] };
	const nodes: CaseNetworkNode[] = [...network.nodes];
	const edges: CaseNetworkEdge[] = [...network.edges];
	const caseId = `case:${network.caseId}`;
	for (const r of relations) {
		const id = `connected:${r.case.id}`;
		if (nodes.some((n) => n.id === id)) continue;
		nodes.push({
			id,
			kind: "connected_case",
			label: r.case.caseNumber,
			sublabel: r.entityName ?? r.relationType,
			weight: 2,
			caseId: r.case.id,
		});
		edges.push({
			source: caseId,
			target: id,
			kind: "connected_case",
			label: r.entityName ?? r.relationType,
		});
	}
	return { nodes, edges };
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div className="flex flex-col">
			<span className="font-mono text-meta uppercase tracking-[0.12em] text-outline">{label}</span>
			<span className="font-mono text-body-lg font-bold tabular-nums text-on-surface">{value}</span>
		</div>
	);
}

function Section({
	title,
	count,
	children,
}: {
	title: string;
	count: number;
	children: ReactNode;
}) {
	return (
		<div className="border-b border-outline-variant/20">
			<div className="px-3 pt-3 pb-1 flex items-center justify-between">
				<span className="font-mono text-meta uppercase tracking-[0.12em] text-outline">{title}</span>
				<span className="font-mono text-meta tabular-nums text-outline">{count}</span>
			</div>
			<div className="pb-2">{children}</div>
		</div>
	);
}

function LegendRow({
	letter,
	label,
	meta,
	count,
	active,
	onClick,
	onDoubleClick,
}: {
	letter: string;
	label: string;
	meta?: string;
	count?: number;
	active?: boolean;
	onClick?: () => void;
	onDoubleClick?: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			onDoubleClick={onDoubleClick}
			className={`w-full text-left px-3 py-1.5 flex items-start gap-2 border-l-2 ${
				active
					? "border-primary bg-primary/[0.06]"
					: "border-transparent hover:bg-surface-container-high"
			}`}
		>
			<span className="font-mono text-meta text-outline w-3 shrink-0 pt-0.5">{letter}</span>
			<span className="min-w-0 flex-1">
				<span className="block font-mono text-body text-on-surface truncate">{label}</span>
				{meta && (
					<span className="block font-mono text-meta text-outline truncate">{meta}</span>
				)}
			</span>
			{count != null && (
				<span className="font-mono text-meta tabular-nums text-outline shrink-0">{count}</span>
			)}
		</button>
	);
}

function WorkActions({
	isFocus,
	expanding,
	onEnter,
	onExpand,
	onBurst,
}: {
	isFocus: boolean;
	expanding: boolean;
	onEnter: () => void;
	onExpand: () => void;
	onBurst?: () => void;
}) {
	return (
		<div className="flex flex-wrap gap-2">
			{!isFocus && (
				<Button variant="ghost" size="sm" brackets={false} className="text-meta text-primary/70" onClick={onEnter}>
					GO_INSIDE
				</Button>
			)}
			{onBurst && (
				<Button variant="ghost" size="sm" brackets={false} className="text-meta text-primary/70" onClick={onBurst}>
					BURST_NEIGHBORS
				</Button>
			)}
			<Button>
				variant="ghost"
				size="sm"
				brackets={false}
				className="text-meta text-primary/70"
				onClick={onExpand}
				disabled={expanding}
			>
				{expanding ? "EXPANDING…" : "EXPAND_INTO_GRAPH"}
			</Button>
		</div>
	);
}

function WhatThisIs({
	node,
	network,
	activeCase,
	relations,
	isFocus,
	expanding,
	onEnter,
	onExpand,
	onBurst,
}: {
	node: CaseNetworkNode;
	network?: CaseNetworkData | null;
	activeCase?: CaseData;
	relations: CaseRelationData[];
	isFocus: boolean;
	expanding: boolean;
	onEnter: () => void;
	onExpand: () => void;
	onBurst?: () => void;
}) {
	if (node.kind === "case") {
		return (
			<div className="space-y-3">
				<div className="font-mono text-meta uppercase tracking-[0.12em] text-outline">CASE</div>
				<h2 className="font-mono text-lg font-medium text-on-surface">
					{network?.title || node.label}
				</h2>
				<p className="font-mono text-body text-on-surface reading">
					{isFocus
						? "This case is the current graph. Documents, roles, and NER entities hang off it. Double-click any box to open that node’s own network."
						: "Another case in this view. Go inside to load its documents and people, or expand to fold them into the working graph."}
				</p>
				<WorkActions isFocus={isFocus} expanding={expanding} onEnter={onEnter} onExpand={onExpand} onBurst={onBurst} />
				<div className="flex flex-wrap gap-2">
					<StatusChip variant="muted" size="sm">
						{network?.caseType || activeCase?.caseType || "case"}
					</StatusChip>
					<StatusChip variant={network?.status === "active" ? "success" : "muted"} size="sm">
						{network?.status || activeCase?.status || "unknown"}
					</StatusChip>
				</div>
				{network && (
					<Button variant="ghost" size="sm" asChild>
						<Link to="/cases/$caseId" params={{ caseId: String(network.caseId) }}>
							OPEN_CASE
						</Link>
					</Button>
				)}
			</div>
		);
	}

	if (node.kind === "role") {
		return (
			<div className="space-y-3">
				<div className="font-mono text-meta uppercase tracking-[0.12em] text-outline">ROLE</div>
				<h2 className="font-mono text-lg font-medium text-on-surface">
					{roleLabel(node.role ?? node.label)}
				</h2>
				<p className="font-mono text-body text-on-surface reading">
					{node.mentionCount ?? 0} extracted {node.mentionCount === 1 ? "person" : "people"}{" "}
					carry this role. Go inside to see every case and document they appear in.
				</p>
				<WorkActions isFocus={isFocus} expanding={expanding} onEnter={onEnter} onExpand={onExpand} onBurst={onBurst} />
			</div>
		);
	}

	if (node.kind === "entity") {
		return (
			<div className="space-y-3">
				<div className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
					NER ENTITY
				</div>
				<h2 className="font-mono text-lg font-medium text-on-surface">{node.label}</h2>
				<p className="font-mono text-body text-on-surface reading">
					Mentioned {node.mentionCount ?? 0} times across {node.documentCount ?? 0}{" "}
					document{(node.documentCount ?? 0) === 1 ? "" : "s"}. Go inside to see every
					other case and file this name appears in, plus people who co-occur.
				</p>
				<WorkActions isFocus={isFocus} expanding={expanding} onEnter={onEnter} onExpand={onExpand} onBurst={onBurst} />
				{node.normalizedName && (
					<Button variant="ghost" size="sm" asChild>
						<Link
							to="/entities/$entityName"
							params={{ entityName: encodeURIComponent(node.normalizedName) }}
						>
							OPEN_DOSSIER
						</Link>
					</Button>
				)}
			</div>
		);
	}

	if (node.kind === "document") {
		return (
			<div className="space-y-3">
				<div className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
					DOCUMENT
				</div>
				<h2 className="font-mono text-lg font-medium text-on-surface">{node.label}</h2>
				<p className="font-mono text-body text-on-surface reading">
					Source file ({node.sublabel || node.documentType || "document"}). Go inside
					for the people in this file, sibling documents, and the parent case.
				</p>
				<WorkActions isFocus={isFocus} expanding={expanding} onEnter={onEnter} onExpand={onExpand} onBurst={onBurst} />
			</div>
		);
	}

	if (node.kind === "connected_case") {
		const rel = relations.find((r) => r.case.id === node.caseId);
		return (
			<div className="space-y-3">
				<div className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
					CONNECTED CASE
				</div>
				<h2 className="font-mono text-lg font-medium text-on-surface">
					{rel?.case.title || node.label}
				</h2>
				<p className="font-mono text-body text-on-surface reading">
					Linked by {rel?.entityName || "a shared entity"} ({rel?.relationType || "shared"}).
					Go inside to work that case&apos;s graph.
				</p>
				<WorkActions isFocus={isFocus} expanding={expanding} onEnter={onEnter} onExpand={onExpand} onBurst={onBurst} />
			</div>
		);
	}

	return null;
}
