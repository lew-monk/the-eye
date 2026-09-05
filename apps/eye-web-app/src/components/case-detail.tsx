import { useId, useMemo, useRef, useState } from "react";
import { WeightBar, StatusDot, StatusChip, HudDialog, Button, EmptyStatePreset, Drawer } from "@workspace/ui";
import type {
	ParticipantEntity,
	ChunkData,
	CaseChunkData,
	EntitySearchResult,
	EntityConfidence,
	EntityTrajectory,
	ChronologyEvent,
} from "#/integrations/trpc/routers/cases";
import { useTRPC } from "#/integrations/trpc/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

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
};

const ROLE_STRIP_COLORS: Record<string, string> = {
	judge: "var(--tertiary)",
	lawyer: "var(--primary)",
	police: "var(--secondary)",
};

const ROLE_CHIP: Record<string, "default" | "success" | "warning" | "error" | "secondary" | "muted"> = {
	judge: "secondary",
	lawyer: "default",
	police: "warning",
	defendant: "error",
	plaintiff: "muted",
	prosecutor: "default",
	prosecution: "default",
	witness: "muted",
	magistrate: "secondary",
	court: "muted",
};

function roleStripColor(role: string): string {
	return ROLE_STRIP_COLORS[role] ?? "var(--role-other)";
}

function roleLabel(role: string): string {
	return ROLE_LABELS[role] ?? role.toUpperCase().replace(/_/g, "_");
}

function firstSentence(text: string): string {
	const clean = text.replace(/\s+/g, " ").trim();
	const parts = clean.split(/(?<=[.!?])\s+(?=[A-Z"'(])/);
	if (parts[0] && parts[0].length <= 180) return parts[0];
	return clean.length > 160 ? `${clean.slice(0, 160).trim()}…` : clean;
}

function firstThreeSentences(text: string): { excerpt: string; hasMore: boolean } {
	const clean = text.replace(/\s+/g, " ").trim();
	const parts = clean.split(/(?<=[.!?])\s+(?=[A-Z"'(])/);
	if (parts.length < 2) {
		const truncated = clean.length > 280 ? clean.slice(0, 280).trim() : clean;
		return { excerpt: truncated, hasMore: clean.length > 280 };
	}
	const first3 = parts.slice(0, 3).join(" ");
	const hasMore = parts.length > 3 || clean.length > first3.length + 10;
	return { excerpt: first3, hasMore };
}

export function SectionHeader({
	label,
	count,
	actionLabel,
	onAction,
}: {
	label: string;
	count: number;
	actionLabel?: string;
	onAction?: () => void;
	compact?: boolean;
}) {
	return (
		<div className="flex items-center justify-between">
			<div className="flex items-center gap-2">
				<StatusDot variant="default" size="sm" pulse />
				<span className="font-mono uppercase tracking-[0.12em] text-meta text-outline">
					{label}
				</span>
				<span className="font-mono text-meta tabular-nums text-outline">{count}</span>
			</div>
			{actionLabel && onAction && (
				<Button variant="default" size="sm" onClick={onAction}>
					{actionLabel}
				</Button>
			)}
		</div>
	);
}

const KIND_CHIP: Record<string, "default" | "success" | "warning" | "error" | "secondary" | "muted"> = {
	incident: "warning",
	arrest: "error",
	filing: "secondary",
	hearing: "default",
	judgment: "success",
	document: "muted",
	other: "muted",
};

const KIND_DOT: Record<string, "default" | "success" | "warning" | "error" | "muted"> = {
	incident: "warning",
	arrest: "error",
	filing: "default",
	hearing: "default",
	judgment: "success",
	document: "muted",
	other: "muted",
};

function formatTimelineDate(iso: string): { day: string; rest: string } {
	const [y, m, d] = iso.split("-");
	const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
	const mi = Number(m) - 1;
	return {
		day: d ?? iso,
		rest: `${months[mi] ?? m} ${y ?? ""}`.trim(),
	};
}

export function EventChronologyTimeline({ events }: { events: ChronologyEvent[] }) {
	const groups = useMemo(() => {
		const byDate = new Map<string, ChronologyEvent[]>();
		for (const ev of events) {
			const list = byDate.get(ev.date) ?? [];
			list.push(ev);
			byDate.set(ev.date, list);
		}
		return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
	}, [events]);

	return (
		<div className="px-5 py-4">
			{groups.map(([date, items], groupIdx) => {
				const label = formatTimelineDate(date);
				return (
					<div key={date} className={groupIdx > 0 ? "mt-6" : ""}>
						<div className="flex items-baseline gap-3 mb-3">
							<span className="font-mono text-lg font-bold tabular-nums text-primary leading-none">
								{label.day}
							</span>
							<span className="font-mono text-meta uppercase tracking-[0.16em] text-outline">
								{label.rest}
							</span>
							<div className="flex-1 h-px bg-outline-variant/25" />
							<span className="font-mono text-meta tabular-nums text-outline">
								{items.length} {items.length === 1 ? "EVENT" : "EVENTS"}
							</span>
						</div>

						<div>
							{items.map((ev, i) => {
								const last = i === items.length - 1;
								const kind = ev.kind || "other";
								const summary =
									ev.summary ||
									ev.quote ||
									`${kind.replace(/_/g, " ")} recorded in ${ev.filename}`;
								return (
									<div key={ev.id ?? `${ev.documentId}-${ev.date}-${i}`} className="flex gap-3">
										<div className="flex flex-col items-center w-4 shrink-0 pt-1">
											<StatusDot
												variant={KIND_DOT[kind] ?? "muted"}
												size="md"
												className="ring-2 ring-background"
											/>
											{!last && (
												<div className="w-px flex-1 min-h-6 bg-outline-variant/40 mt-1" />
											)}
										</div>
										<div className={`flex-1 min-w-0 ${last ? "pb-0" : "pb-5"}`}>
											<div className="flex items-center gap-2 flex-wrap mb-1.5">
												<StatusChip variant={KIND_CHIP[kind] ?? "muted"} size="sm">
													{kind.replace(/_/g, " ")}
												</StatusChip>
												<span className="font-mono text-meta uppercase tracking-wider text-outline">
													{ev.documentType.replace(/_/g, " ")}
												</span>
											</div>
											<p className="font-mono text-body text-on-surface reading">
												{summary}
											</p>
											<div className="flex flex-wrap items-center gap-1 mt-2">
												{ev.entities.slice(0, 4).map((e) => (
													<Link
														key={e.normalizedName}
														to="/entities/$entityName"
														params={{
															entityName: encodeURIComponent(e.normalizedName),
														}}
														className="font-mono text-meta-sm text-on-surface bg-primary/[0.08] px-1.5 py-0.5 hover:bg-primary/[0.14] transition-colors"
													>
														{e.name}
													</Link>
												))}
												{(ev.unresolvedRefs ?? []).slice(0, 2).map((ref) => (
													<StatusChip key={ref} variant="warning" size="sm">
														{ref}
													</StatusChip>
												))}
											</div>
											<span className="font-mono text-meta text-outline/80 mt-1.5 block truncate">
												{ev.filename}
											</span>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				);
			})}
		</div>
	);
}

interface ParticipantRowProps {
	participant: ParticipantEntity;
	documents: { id: number; filename: string }[];
	caseId: number;
	density?: "standard" | "compact";
	className?: string;
}

export function ParticipantRow({
	participant,
	documents,
	caseId,
	density = "standard",
	className,
}: ParticipantRowProps) {
	const [expanded, setExpanded] = useState(false);
	const [activeMentionIdx, setActiveMentionIdx] = useState<number | null>(null);
	const compact = density === "compact";
	const trpc = useTRPC();

	const score = participant.relevanceScore ?? 0;
	const mentions = participant.mentions ?? [];
	const isManual = mentions.length === 0;
	const docNameById = new Map(documents.map((d) => [d.id, d.filename]));

	const activeMention = activeMentionIdx != null ? mentions[activeMentionIdx] : null;

	const { data: mentionContextResult } = useQuery({
		...trpc.cases.getEntityMentionContexts.queryOptions({
			normalizedName: participant.normalizedName,
			caseId,
			mentionIndex: activeMentionIdx ?? undefined,
		}),
		enabled: activeMentionIdx != null,
	});

	const activeContext = activeMentionIdx != null ? (mentionContextResult?.[0] ?? null) : null;

	return (
		<div className={className}>
			<div
				className={`${
					compact ? "bracket-bottom-right-compact" : "bracket-bottom-right-only"
				} ${compact ? "px-3 py-2" : "px-5 py-3"} cursor-pointer`}
				onClick={() => setExpanded(!expanded)}
			>
				<div className="flex items-start gap-3 relative">
					<div
						className={`absolute left-0 top-0 bottom-0 ${
							compact ? "w-0.5" : "w-1"
						}`}
						style={{ backgroundColor: roleStripColor(participant.role) }}
					/>

					<div className={`flex-1 min-w-0 ${compact ? "pl-2" : "pl-3"}`}>
						<div className="flex items-center gap-2 mb-1 flex-wrap">
							<Link
								to="/entities/$entityName"
								params={{ entityName: encodeURIComponent(participant.normalizedName) }}
								className="font-mono text-body-lg text-on-surface hover:text-primary transition-colors"
								onClick={(e: React.MouseEvent) => e.stopPropagation()}
							>
								{participant.name}
							</Link>
							<StatusChip variant={ROLE_CHIP[participant.role] ?? "muted"} size="sm">
								{roleLabel(participant.role)}
							</StatusChip>
							{isManual && (
								<StatusChip variant="muted" size="sm" dot={false}>
									MANUAL
								</StatusChip>
							)}
						</div>

						<div className="font-mono text-meta text-outline">
							<span className="tabular-nums">{participant.mentionCount} mentions</span>
							<span className="mx-1.5 text-outline-variant">·</span>
							<span className="tabular-nums">
								{participant.documentCount} doc{participant.documentCount !== 1 ? "s" : ""}
							</span>
						</div>
					</div>

					<div className={`shrink-0 ${compact ? "pt-1" : "pt-1.5"}`}>
						<span
							className={`font-mono text-outline transition-transform duration-200 select-none ${
								expanded ? "rotate-180" : ""
							} ${compact ? "text-body-lg" : "text-body-lg"}`}
							style={{ display: "inline-block" }}
						>
							▾
						</span>
					</div>
				</div>
			</div>

			{expanded && (
				<div className="border-t border-outline-variant/10">
					<div className={`${compact ? "px-3 py-2 pl-6" : "px-5 py-3 pl-8"} space-y-2`}>
						{participant.confidence && (
							<div className="flex items-center gap-2 flex-wrap">
								<StatusChip
									variant={
										participant.confidence.score >= 80
											? "success"
											: participant.confidence.score >= 50
												? "warning"
												: "error"
									}
									size="sm"
									dot={false}
								>
									<span className="text-outline mr-0.5">CONF</span>
									{participant.confidence.score}%
								</StatusChip>
								{participant.confidence.flags.slice(0, 2).map((flag) => (
									<span key={flag} className="font-mono text-meta text-warning/80">
										{flag}
									</span>
								))}
							</div>
						)}
						{mentions.length > 0 && (
							<div className="flex items-center gap-1 flex-wrap">
								{mentions.slice(0, 5).map((m) => (
									<span
										key={m}
										className="font-mono text-meta-sm text-outline border border-outline-variant/30 px-1.5 py-0.5 truncate max-w-[180px]"
									>
										{m}
									</span>
								))}
								{mentions.length > 5 && (
									<span className="font-mono text-meta-sm text-outline">
										+{mentions.length - 5}
									</span>
								)}
							</div>
						)}
						<div className="flex items-center gap-2">
							<span className="font-mono text-meta uppercase tracking-wider text-outline shrink-0">
								RELEV
							</span>
							<WeightBar value={score} density={density} className="flex-1" />
						</div>
					</div>
					{mentions.map((mention, i) => {
						const docId = documents[i % documents.length]?.id;
						const docName = docId != null ? (docNameById.get(docId) ?? `DOC-${docId}`) : "Unknown";
						const isActive = activeMentionIdx === i;
						return (
							<div
								key={`${participant.id}-mention-${i}`}
								className={`${
									compact ? "px-3 py-1.5 pl-6" : "px-5 py-2 pl-8"
								} border-b border-outline-variant/10 last:border-b-0 ${
									isActive ? "bg-primary/[0.04]" : ""
								}`}
							>
								<div className="flex items-start justify-between gap-4">
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2 mb-0.5">
											<span className="font-mono text-meta text-outline">
												→
											</span>
											<span className="font-mono text-body text-on-surface truncate">
												{docName}
											</span>
										</div>
										{mention && (
											<p className="font-mono text-body text-on-surface reading line-clamp-2 mt-0.5">
												{mention}
											</p>
										)}
									</div>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										brackets={false}
										className="text-meta text-primary/70 hover:text-primary shrink-0 mt-0.5"
										onClick={(e) => {
											e.stopPropagation();
											setActiveMentionIdx(isActive ? null : i);
										}}
									>
										VIEW_CHUNK →
									</Button>
								</div>
				
								{isActive && (
									<div className={`mt-2 border border-primary/20 bg-primary/5 ${compact ? "p-2" : "p-3"}`}>
										<div className="flex items-center justify-between mb-1.5">
											<span className="font-mono uppercase tracking-[0.1em] text-meta-sm text-outline">
												CONTEXT_LENS
											</span>
											{activeContext && (
												<span className="font-mono text-meta-sm text-outline">
													POS: [{activeContext.start}..{activeContext.end}]
												</span>
											)}
										</div>
										{activeContext ? (
											<>
												{activeContext.filename && (
													<span className="block font-mono text-meta text-outline mb-1 truncate">
														{activeContext.filename}
													</span>
												)}
												<p className="font-mono text-body reading">
													{(() => {
														const ctx = activeContext.context
														const hasLeadingEllipsis = ctx.startsWith('\u2026')
														const clean = hasLeadingEllipsis ? ctx.slice(1) : ctx
														const mentionLen = activeContext.text.length
														const fromText = mentionLen
															? clean.toLowerCase().indexOf(activeContext.text.toLowerCase())
															: -1
														const offset = fromText >= 0 ? fromText : Math.min(150, activeContext.start)
														const prefix = hasLeadingEllipsis ? '\u2026' : ''
														return (
															<>
																<span className="text-outline">{prefix}{clean.slice(0, offset)}</span>
																<mark className="text-on-surface bg-primary/15 px-0.5">{clean.slice(offset, offset + mentionLen)}</mark>
																<span className="text-outline">{clean.slice(offset + mentionLen)}</span>
															</>
														)
													})()}
												</p>
											</>
										) : (
											<p className="font-mono text-body text-on-surface reading">
												{activeMention ?? mention}
											</p>
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

interface DocumentChunksProps {
	documentId: number;
	density?: "standard" | "compact";
}

export function DocumentChunks({ documentId, density = "standard" }: DocumentChunksProps) {
	const trpc = useTRPC();
	const [expanded, setExpanded] = useState(false);
	const [showAll, setShowAll] = useState(false);
	const compact = density === "compact";

	const { data: chunks = [] } = useQuery({
		...trpc.cases.getDocumentChunks.queryOptions({ documentId }),
		enabled: expanded,
	});

	const visibleChunks = showAll ? chunks : chunks.slice(0, 5);
	const hasMore = chunks.length > 5;

	return (
		<div>
			<div
				className={`${
					compact ? "px-3 py-1.5" : "px-5 py-2"
				} border-t border-outline-variant/10 cursor-pointer flex items-center justify-between`}
				onClick={() => setExpanded(!expanded)}
			>
				<span
					className={`font-mono uppercase tracking-[0.12em] text-outline ${
						compact ? "text-meta-sm" : "text-meta"
					}`}
				>
					TOP_CHUNKS
				</span>
				<span
					className={`font-mono text-outline transition-transform duration-200 select-none ${
						expanded ? "rotate-180" : ""
					} ${compact ? "text-body-lg" : "text-body-lg"}`}
					style={{ display: "inline-block" }}
				>
					▾
				</span>
			</div>

			{expanded && (
				<div className="border-t border-outline-variant/10">
					{chunks.length === 0 ? (
						<EmptyStatePreset variant="awaiting-analysis" size="sm" />
					) : (
						<>
							{visibleChunks.map((chunk) => (
								<ChunkExcerpt key={chunk.id} chunk={chunk} index={chunk.chunkIndex} density={density} />
							))}
							{hasMore && !showAll && (
								<Button
									variant="ghost"
									size="sm"
									brackets={false}
									className="w-full text-meta text-primary/70 border-t border-outline-variant/10"
									onClick={(e) => {
										e.stopPropagation();
										setShowAll(true);
									}}
								>
									SHOW_MORE ({chunks.length - 5} REMAINING)
								</Button>
							)}
						</>
					)}
				</div>
			)}
		</div>
	);
}

const REDACTION_TAG_RE = /\[([A-Z][A-Z_]+)\]/g;

function renderChunkWithTags(text: string): React.ReactNode[] {
	const parts: React.ReactNode[] = [];
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	REDACTION_TAG_RE.lastIndex = 0;
	while ((match = REDACTION_TAG_RE.exec(text)) !== null) {
		if (match.index > lastIndex) {
			parts.push(text.slice(lastIndex, match.index));
		}
		parts.push(
			<span
				key={`tag-${match.index}`}
				className="font-mono text-meta-sm text-primary/60 bg-primary/[0.06] px-1 py-0.5 mx-0.5"
			>
				{match[1]}
			</span>,
		);
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}
	return parts;
}

const DASH_CLAUSE_RE = /^(?:[—–-]\s+.*(?:\s+[—–-]\s+.*){2,})/;

function hasDashClauses(text: string): boolean {
	return DASH_CLAUSE_RE.test(text.trim());
}

function ChunkExcerpt({
	chunk,
	index,
	density = "standard",
	sourceFilename,
}: {
	chunk: ChunkData | CaseChunkData;
	index: number;
	density?: "standard" | "compact";
	sourceFilename?: string;
}) {
	const [open, setOpen] = useState(false);
	const weight = chunk.positionWeight ?? 0;
	const { excerpt, hasMore } = firstThreeSentences(chunk.text);
	const lead = firstSentence(chunk.text);
	const displayIndex = String(index + 1).padStart(2, "0");
	const compact = density === "compact";
	const isDashList = hasDashClauses(excerpt);

	return (
		<div
			className={`${
				compact ? "px-3 py-2" : "px-5 py-3"
			} border-b border-outline-variant/10 last:border-b-0 cursor-pointer`}
			onClick={() => setOpen(!open)}
		>
			<div className="flex items-center gap-3 mb-1">
				<span className="font-mono text-meta text-outline tabular-nums shrink-0 w-5">
					{displayIndex}
				</span>
				<WeightBar value={weight} density={density} className="flex-1 max-w-[320px]" />
				<span
					className={`font-mono text-outline transition-transform duration-200 select-none inline-block ${
						open ? "rotate-180" : ""
					}`}
				>
					▾
				</span>
			</div>
			{sourceFilename && (
				<p className={`font-mono text-meta text-outline truncate ${compact ? "pl-6" : "pl-8"}`}>
					{sourceFilename}
				</p>
			)}
			{!open ? (
				<p className={`font-mono text-body text-on-surface reading line-clamp-2 ${compact ? "pl-6" : "pl-8"}`}>
					{lead}
				</p>
			) : isDashList ? (
				<ul
					className={`font-mono text-body text-on-surface reading list-none ${
						compact ? "pl-6" : "pl-8"
					}`}
				>
					{excerpt.split(/\s*[—–-]\s+/).filter(Boolean).map((clause, ci) => (
						<li key={ci} className="flex items-start gap-2">
							<span className="text-outline/40 mt-0.5 shrink-0">—</span>
							<span>{clause}</span>
						</li>
					))}
					{hasMore && <li className="text-outline">…</li>}
				</ul>
			) : (
				<p className={`font-mono text-body text-on-surface reading ${compact ? "pl-6" : "pl-8"}`}>
					{REDACTION_TAG_RE.test(excerpt) ? renderChunkWithTags(excerpt) : excerpt}
					{hasMore && <span className="text-outline">…</span>}
				</p>
			)}
		</div>
	);
}

interface CaseWideChunksProps {
	caseId: number;
	density?: "standard" | "compact";
}

export function CaseWideChunks({ caseId, density = "compact" }: CaseWideChunksProps) {
	const trpc = useTRPC();
	const [showAll, setShowAll] = useState(false);
	const compact = density === "compact";

	const { data: chunks = [] } = useQuery({
		...trpc.cases.getCaseChunks.queryOptions({ caseId }),
		enabled: !Number.isNaN(caseId),
	});

	const visibleChunks = showAll ? chunks : chunks.slice(0, 5);
	const hasMore = chunks.length > 5;

	return (
		<div>
			<SectionHeader label="TOP_CHUNKS" count={chunks.length} compact={compact} />

			<div className={`${compact ? "bracket-both-compact" : "bracket-top-left bracket-bottom-right"} ${compact ? "p-0" : ""}`}>
				{chunks.length === 0 ? (
					<EmptyStatePreset variant="awaiting-analysis" size="sm" />
				) : (
					<>
						{visibleChunks.map((chunk, i) => (
							<ChunkExcerpt
								key={chunk.id}
								chunk={chunk}
								index={i}
								density={density}
								sourceFilename={chunk.filename}
							/>
						))}
						{hasMore && !showAll && (
							<Button
								variant="ghost"
								size="sm"
								brackets={false}
								className="w-full text-meta text-primary/70 border-t border-outline-variant/10"
								onClick={() => setShowAll(true)}
							>
								SHOW_MORE ({chunks.length - 5} REMAINING)
							</Button>
						)}
					</>
				)}
			</div>
		</div>
	);
}

const PARTICIPANT_ROLES = [
	{ value: "judge", label: "Judge" },
	{ value: "lawyer", label: "Lawyer" },
	{ value: "police", label: "Police" },
	{ value: "witness", label: "Witness" },
	{ value: "defendant", label: "Defendant" },
	{ value: "plaintiff", label: "Plaintiff" },
	{ value: "prosecutor", label: "Prosecutor" },
	{ value: "magistrate", label: "Magistrate" },
	{ value: "court", label: "Court" },
	{ value: "other", label: "Other" },
];

interface AddParticipantDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	caseId: number;
	documents: { id: number; filename: string }[];
}

export function AddParticipantDialog({
	open,
	onOpenChange,
	caseId,
	documents,
}: AddParticipantDialogProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [role, setRole] = useState("other");
	const [documentId, setDocumentId] = useState<number | "">("");
	const [error, setError] = useState<string | null>(null);

	const addMutation = useMutation({
		...trpc.cases.addParticipant.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries(
				trpc.cases.getParticipants.queryOptions({ caseId }),
			);
			onOpenChange(false);
			setName("");
			setRole("other");
			setDocumentId("");
			setError(null);
		},
		onError: (err) => {
			setError(err instanceof Error ? err.message : "Failed to add participant");
		},
	});

	const handleAdd = async () => {
		if (!name.trim()) {
			setError("Name is required");
			return;
		}
		if (documents.length === 0) {
			setError("Upload a document before adding a participant");
			return;
		}
		setError(null);
		try {
			await addMutation.mutateAsync({
				caseId,
				name: name.trim(),
				role,
				...(documentId !== "" ? { documentId } : {}),
			});
		} catch {
			// onError sets the message
		}
	};

	return (
		<HudDialog
			open={open}
			onOpenChange={onOpenChange}
			title="ADD_PARTICIPANT"
			variant="form"
			size="sm"
			primaryActionLabel="ADD_PARTICIPANT"
			onPrimaryAction={handleAdd}
			loading={addMutation.isPending}
		>
			<div className="space-y-4">
				{error && (
					<div className="border border-destructive/30 bg-destructive/5 p-2 flex items-center gap-2">
						<StatusDot variant="error" size="sm" />
						<span className="font-mono text-body text-destructive/70">{error}</span>
					</div>
				)}

				<div>
					<label className="font-mono text-body uppercase tracking-[0.12em] text-on-surface-variant block mb-1.5">
						NAME
					</label>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="w-full bg-surface border border-outline text-foreground font-mono text-body px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
						placeholder="Full name"
					/>
				</div>

				<div>
					<label className="font-mono text-body uppercase tracking-[0.12em] text-on-surface-variant block mb-1.5">
						ROLE
					</label>
					<select
						className="w-full bg-surface border border-outline text-foreground font-mono text-body px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
						value={role}
						onChange={(e) => setRole(e.target.value)}
					>
						{PARTICIPANT_ROLES.map((r) => (
							<option key={r.value} value={r.value}>
								{r.label}
							</option>
						))}
					</select>
				</div>

				{documents.length > 1 && (
					<div>
						<label className="font-mono text-body uppercase tracking-[0.12em] text-on-surface-variant block mb-1.5">
							DOCUMENT
						</label>
						<select
							className="w-full bg-surface border border-outline text-foreground font-mono text-body px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
							value={documentId === "" ? "" : String(documentId)}
							onChange={(e) =>
								setDocumentId(e.target.value ? Number(e.target.value) : "")
							}
						>
							<option value="">First document (default)</option>
							{documents.map((d) => (
								<option key={d.id} value={d.id}>
									{d.filename}
								</option>
							))}
						</select>
					</div>
				)}
			</div>
		</HudDialog>
	);
}

export function documentFileUrl(
	documentId: number,
	disposition: "inline" | "attachment" = "inline",
): string {
	return `/api/documents/${documentId}/file?disposition=${disposition}`;
}

function previewKind(doc: {
	filename: string;
	fileType?: string | null;
	contentType?: string | null;
}): "pdf" | "image" | "other" {
	const hint = `${doc.contentType ?? ""} ${doc.fileType ?? ""} ${doc.filename}`.toLowerCase();
	if (hint.includes("pdf")) return "pdf";
	if (/(png|jpe?g|jpg|gif|webp|bmp)/.test(hint)) return "image";
	return "other";
}

interface DocumentPreviewDrawerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	document: {
		id: number;
		filename: string;
		fileType?: string | null;
		contentType?: string | null;
	} | null;
}

export function DocumentPreviewDrawer({
	open,
	onOpenChange,
	document: doc,
}: DocumentPreviewDrawerProps) {
	const lastDoc = useRef(doc);
	if (doc) lastDoc.current = doc;
	const current = doc ?? lastDoc.current;
	if (!current) return null;

	const kind = previewKind(current);
	const inlineUrl = documentFileUrl(current.id, "inline");
	const downloadUrl = documentFileUrl(current.id, "attachment");

	return (
		<Drawer
			open={open}
			onOpenChange={onOpenChange}
			title={current.filename}
			size="xl"
			bodyClassName="overflow-hidden p-0 flex flex-col"
		>
			<div className="flex items-center justify-between gap-3 px-5 py-2 border-b border-outline-variant/30 shrink-0">
				<span className="font-mono text-meta uppercase tracking-wider text-outline truncate">
					{kind === "pdf" ? "PDF_VIEWER" : kind === "image" ? "IMAGE_VIEWER" : "FILE_PREVIEW"}
				</span>
				<Button variant="ghost" size="sm" brackets={false} className="shrink-0 text-meta" asChild>
					<a href={downloadUrl} download={current.filename}>
						DOWNLOAD
					</a>
				</Button>
			</div>
			{kind === "pdf" ? (
				<iframe
					title={current.filename}
					src={inlineUrl}
					className="flex-1 w-full min-h-0 border-0 bg-surface-container-lowest"
				/>
			) : kind === "image" ? (
				<div className="flex-1 overflow-auto bg-surface-container-lowest p-4 flex items-start justify-center">
					<img
						src={inlineUrl}
						alt={current.filename}
						className="max-w-full h-auto border border-outline-variant/20"
					/>
				</div>
			) : (
				<div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
					<span className="font-mono text-body text-outline">
						Preview is not available for this file type.
					</span>
					<Button variant="ghost" size="sm" asChild>
						<a href={downloadUrl} download={current.filename}>
							DOWNLOAD_FILE
						</a>
					</Button>
				</div>
			)}
		</Drawer>
	);
}

interface EntitySearchDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function EntitySearchDialog({ open, onOpenChange }: EntitySearchDialogProps) {
	const trpc = useTRPC();
	const [query, setQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const timerRef = useState<ReturnType<typeof setTimeout> | null>(null);

	const handleChange = (value: string) => {
		setQuery(value);
		if (timerRef[0]) clearTimeout(timerRef[0]);
		timerRef[0] = setTimeout(() => setDebouncedQuery(value), 300);
	};

	const { data, isLoading } = useQuery({
		...trpc.cases.entitySearch.queryOptions({
			name: debouncedQuery || undefined,
			limit: 10,
		}),
		enabled: debouncedQuery.length >= 2,
	});

	const results = data?.data ?? [];
	const total = data?.total ?? 0;

	return (
		<HudDialog
			open={open}
			onOpenChange={onOpenChange}
			title="ENTITY_SEARCH"
			variant="form"
			size="lg"
		>
			<div className="space-y-4">
				<div>
					<label className="font-mono text-body uppercase tracking-[0.12em] text-on-surface-variant block mb-1.5">
						SEARCH_ENTITIES
					</label>
					<input
						type="text"
						value={query}
						onChange={(e) => handleChange(e.target.value)}
						className="w-full bg-surface border border-outline text-foreground font-mono text-body px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
						placeholder="Search by name..."
						autoFocus
					/>
				</div>

				{debouncedQuery.length < 2 ? (
					<div className="py-4 text-center">
						<span className="font-mono text-body text-outline">
							TYPE_AT_LEAST_2_CHARS
						</span>
					</div>
				) : isLoading ? (
					<div className="py-4 text-center">
						<StatusDot variant="muted" size="md" pulse />
						<span className="font-mono text-body text-outline ml-2">
							SEARCHING...
						</span>
					</div>
				) : results.length === 0 ? (
					<EmptyStatePreset
						variant="no-matches"
						size="sm"
						onAction={() => { setQuery(""); setDebouncedQuery(""); }}
					/>
				) : (
					<div className="border border-outline-variant/20 divide-y divide-outline-variant/10">
						<div className="px-3 py-1.5 border-b border-outline-variant/10">
							<span className="font-mono text-meta text-outline">
								{total} RESULT{total !== 1 ? "S" : ""}
							</span>
						</div>
						{results.map((entity: EntitySearchResult) => (
							<Link
								key={entity.id}
								to="/entities/$entityName"
								params={{ entityName: encodeURIComponent(entity.normalizedName) }}
								className="flex items-start justify-between px-3 py-2.5 hover:bg-surface/50 transition-colors block"
								onClick={() => onOpenChange(false)}
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2 mb-0.5">
										<span className="font-mono text-body-lg text-on-surface">
											{entity.name}
										</span>
										<span className="font-mono text-meta-sm uppercase tracking-wider px-1 py-0.5 border border-outline-variant/50 text-outline">
											{entity.role}
										</span>
									</div>
<div className="flex items-center gap-2 text-meta text-outline">
										{entity.caseNumber && (
											<>
												<span className="text-on-surface">{entity.caseNumber}</span>
												<span className="text-outline">|</span>
											</>
										)}
										<span>{entity.documentType}</span>
										{entity.mentionCount != null && (
											<>
												<span className="text-outline">|</span>
												<span>{entity.mentionCount} mentions</span>
											</>
										)}
									</div>
								</div>
								<div className="shrink-0 ml-3 pt-0.5">
									<StatusDot variant="default" size="sm" />
								</div>
							</Link>
						))}
					</div>
				)}
			</div>
		</HudDialog>
	);
}

type TrajectoryTrend = "surge" | "drop" | "stable" | "single";

function trajectoryTrend(points: EntityTrajectory["points"]): {
	trend: TrajectoryTrend;
	delta: number;
	label: string;
} {
	if (points.length < 2) {
		return { trend: "single", delta: 0, label: "FIRST_SEEN" };
	}
	const first = points[0].mentionCount;
	const last = points[points.length - 1].mentionCount;
	const delta = last - first;
	const base = Math.max(first, 1);
	const pct = Math.round((delta / base) * 100);

	if (delta >= Math.max(2, Math.ceil(base * 0.25))) {
		return {
			trend: "surge",
			delta,
			label: pct > 0 ? `SURGE +${pct}%` : "SURGE",
		};
	}
	if (delta <= -Math.max(2, Math.ceil(base * 0.25))) {
		return {
			trend: "drop",
			delta,
			label: `DROP ${pct}%`,
		};
	}
	return { trend: "stable", delta, label: "STABLE" };
}

const TREND_VARIANT: Record<
	TrajectoryTrend,
	"success" | "error" | "muted" | "secondary"
> = {
	surge: "success",
	drop: "error",
	stable: "muted",
	single: "secondary",
}



type SortKey = "drop" | "mentions" | "peak" | "name";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
	{ key: "drop", label: "DROP_%" },
	{ key: "mentions", label: "MENTIONS" },
	{ key: "peak", label: "PEAK" },
	{ key: "name", label: "NAME" },
];

function TrajectorySparkline({
	points,
	maxMentions,
}: {
	points: EntityTrajectory["points"];
	maxMentions: number;
}) {
	const id = useId();
	const w = 140;
	const h = 28;
	if (points.length < 2) return null;

	const count = points.length;
	const pts = points.map((p, i) => ({
		x: (i / Math.max(count - 1, 1)) * (w - 4) + 2,
		y: h - 2 - (p.mentionCount / maxMentions) * (h - 4),
	}));

	function smoothPath(ps: { x: number; y: number }[]): string {
		if (ps.length === 0) return "";
		let d = `M ${ps[0].x} ${ps[0].y}`;
		for (let i = 0; i < ps.length - 1; i++) {
			const p0 = ps[Math.max(0, i - 1)];
			const p1 = ps[i];
			const p2 = ps[i + 1];
			const p3 = ps[Math.min(ps.length - 1, i + 2)];
			const tension = 0.3;
			const cp1x = p1.x + (p2.x - p0.x) * tension;
			const cp1y = p1.y + (p2.y - p0.y) * tension;
			const cp2x = p2.x - (p3.x - p1.x) * tension;
			const cp2y = p2.y - (p3.y - p1.y) * tension;
			d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
		}
		return d;
	}

	const lineD = smoothPath(pts);
	const areaD = `${lineD} L ${pts[pts.length - 1].x} ${h - 2} L ${pts[0].x} ${h - 2} Z`;

	return (
		<svg width={w} height={h} className="shrink-0" viewBox={`0 0 ${w} ${h}`}>
			<defs>
				<linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="var(--primary)" stopOpacity="0.18" />
					<stop offset="60%" stopColor="var(--primary)" stopOpacity="0.06" />
					<stop offset="100%" stopColor="var(--primary)" stopOpacity="0.01" />
				</linearGradient>
			</defs>
			<path d={areaD} fill={`url(#sp-${id})`} />
			<path
				d={lineD}
				fill="none"
				stroke="var(--primary)"
				strokeWidth={1.5}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function SortDropdown({
	value,
	onChange,
	options,
}: {
	value: SortKey;
	onChange: (key: SortKey) => void;
	options: { key: SortKey; label: string }[];
}) {
	const [open, setOpen] = useState(false);
	const currentLabel = options.find((o) => o.key === value)?.label ?? "";

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-1.5 font-mono text-body text-outline hover:text-primary transition-colors"
			>
				<span className="uppercase tracking-wider">SORT</span>
				<span className="text-on-surface-variant">{currentLabel}</span>
				<span
					className={`font-mono text-outline transition-transform duration-200 select-none inline-block ${open ? "rotate-180" : ""}`}
				>
					▾
				</span>
			</button>

			{open && (
				<>
					<div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
					<div className="absolute right-0 top-full mt-1 z-50 border border-outline-variant/30 bg-surface-container-high bracket-top-left bracket-bottom-right min-w-[140px]">
						{options.map((opt) => (
							<button
								key={opt.key}
								type="button"
								onClick={() => {
									onChange(opt.key);
									setOpen(false);
								}}
								className={`block w-full px-3 py-1.5 text-left font-mono text-body uppercase tracking-wider transition-colors hover:bg-primary/5 ${
									value === opt.key ? "text-primary" : "text-on-surface-variant"
								}`}
							>
								{opt.label}
							</button>
						))}
					</div>
				</>
			)}
		</div>
	);
}

function EntityTrajectoryRow({
	trajectory,
}: {
	trajectory: EntityTrajectory & {
		maxMentions: number;
		totalMentions: number;
		trend: TrajectoryTrend;
		trendLabel: string;
		peak: EntityTrajectory["points"][number];
		primaryRole: string | undefined;
	};
}) {
	const [expanded, setExpanded] = useState(false);
	const t = trajectory;

	return (
		<div>
			<div
				className="px-5 py-3 cursor-pointer select-none"
				onClick={() => setExpanded(!expanded)}
			>
				<div className="flex items-start gap-3">
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2 flex-wrap mb-1">
							<Link
								to="/entities/$entityName"
								params={{
									entityName: encodeURIComponent(t.normalizedName),
								}}
								className="font-mono text-body text-on-surface hover:text-primary transition-colors"
								onClick={(e: React.MouseEvent) => e.stopPropagation()}
							>
								{t.displayName}
							</Link>
							{t.primaryRole && (
								<StatusChip variant="muted" size="sm">
									{roleLabel(t.primaryRole)}
								</StatusChip>
							)}
							<StatusChip variant={TREND_VARIANT[t.trend]} size="sm">
								{t.trendLabel}
							</StatusChip>
						</div>
						<div className="flex items-center gap-2 font-mono text-meta text-outline flex-wrap">
							<span className="tabular-nums">{t.totalMentions} MENTIONS</span>
							<span className="text-outline-variant">|</span>
							<span className="tabular-nums">
								{t.points.length} DOC{t.points.length !== 1 ? "S" : ""}
							</span>
							{t.peak && (
								<>
									<span className="text-outline-variant">|</span>
									<span className="truncate max-w-[200px]">
										PEAK {t.peak.mentionCount} @ {t.peak.filename}
									</span>
								</>
							)}
						</div>
					</div>

					{t.points.length >= 2 && (
						<div className="shrink-0 self-center">
							<TrajectorySparkline points={t.points} maxMentions={t.maxMentions} />
						</div>
					)}

					<div className="shrink-0 pt-0.5 self-center">
						<span
							className={`font-mono text-outline transition-transform duration-200 select-none inline-block ${expanded ? "rotate-180" : ""}`}
						>
							▾
						</span>
					</div>
				</div>
			</div>

			{expanded && (
				<div className="border-t border-outline-variant/10 px-5 py-4">
					{(() => {
						const chartH = 96;
						return (
							<div className="relative pl-9 pr-2">
								<div className="relative" style={{ height: `${chartH}px` }}>
									{[0, 1, 2].map((tier) => {
										const val = Math.round((t.maxMentions / 3) * (3 - tier));
										return (
											<div
												key={tier}
												className="absolute left-0 right-0 flex items-center pointer-events-none"
												style={{ bottom: `${(tier / 3) * 100}%` }}
											>
												<span className="font-mono text-meta-sm tabular-nums text-outline w-8 shrink-0 text-right pr-2">
													{val}
												</span>
												<div className="flex-1 border-t border-outline-variant/15" />
											</div>
										);
									})}

									<div className="absolute inset-0 flex items-end gap-1.5 sm:gap-2">
										{t.points.map((p) => {
											const barPx = Math.max(3, Math.round((p.mentionCount / t.maxMentions) * chartH));
											const isHigh = p.mentionCount / t.maxMentions > 0.5;
											return (
												<div
													key={p.documentId}
													className="flex-1 flex flex-col items-center min-w-0 group relative cursor-default justify-end h-full"
												>
													<div className="absolute -top-7 left-1/2 -translate-x-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
														<div className="bg-surface border border-outline-variant/30 px-2 py-1 whitespace-nowrap rounded-sm shadow-md">
															<p className="font-mono text-meta-sm text-on-surface tabular-nums leading-tight">
																{p.mentionCount} mentions
															</p>
															<p className="font-mono text-meta-sm text-outline leading-tight">
																{p.filename}
															</p>
															{p.role && (
																<p className="font-mono text-meta-sm text-outline leading-tight">
																	{roleLabel(p.role)}
																</p>
															)}
														</div>
													</div>

													<div
														className={`w-full max-w-[44px] mx-auto transition-all duration-200 shrink-0 ${
															isHigh ? "bg-primary" : "bg-primary/30"
														}`}
														style={{ height: `${barPx}px` }}
													/>
												</div>
											);
										})}
									</div>
								</div>

								<div className="flex justify-center mt-1">
									<span className="font-mono text-meta-sm uppercase tracking-widest text-outline/40">
										DOCUMENTS →
									</span>
								</div>

								<div className="absolute -left-1 top-0 bottom-0 flex items-center pointer-events-none">
									<span className="font-mono text-meta-sm uppercase tracking-widest text-outline/40 -rotate-90 origin-center whitespace-nowrap">
										MENTIONS
									</span>
								</div>
							</div>
						);
					})()}

					{(() => {
						const roles = t.points.map((p) => p.role).filter(Boolean);
						const unique = [...new Set(roles)];
						if (unique.length < 2) return null;
						return (
							<div className="mt-3 flex items-center gap-1.5 flex-wrap">
								<span className="font-mono text-meta text-outline shrink-0">
									ROLE_PATH
								</span>
								{t.points.map((p, i) => (
									<span
										key={`${p.documentId}-role`}
										className="inline-flex items-center gap-1"
									>
										{i > 0 && (
											<span className="font-mono text-meta text-primary/40">
												→
											</span>
										)}
										<span className="font-mono text-meta text-outline border border-outline-variant/30 px-1.5 py-0.5">
											{roleLabel(p.role)}
										</span>
									</span>
								))}
							</div>
						);
					})()}
				</div>
			)}
		</div>
	);
}

export function EntityTrajectoriesPanel({
	trajectories,
	limit = 8,
}: {
	trajectories: EntityTrajectory[]
	limit?: number
}) {
	const [sortKey, setSortKey] = useState<SortKey>("drop");

	const processed = useMemo(() => {
		const withStats = trajectories.map((t) => {
			const maxMentions = Math.max(...t.points.map((p) => p.mentionCount), 1);
			const totalMentions = t.points.reduce((s, p) => s + p.mentionCount, 0);
			const { trend, label: trendLabel } = trajectoryTrend(t.points);
			const peak = t.points.reduce(
				(best, p) => (p.mentionCount > best.mentionCount ? p : best),
				t.points[0],
			);
			const primaryRole =
				[...t.points]
					.reverse()
					.find((p) => p.role)?.role ?? t.points[0]?.role;
			return {
				...t,
				maxMentions,
				totalMentions,
				trend,
				trendLabel,
				peak,
				primaryRole,
			};
		});

		const multiDoc = withStats.filter((t) => t.points.length >= 2);
		const pool = multiDoc.length > 0 ? multiDoc : withStats;

		switch (sortKey) {
			case "drop":
				return [...pool].sort((a, b) => {
					const dropA = a.points.length >= 2 ? a.points[a.points.length - 1].mentionCount - a.points[0].mentionCount : 0;
					const dropB = b.points.length >= 2 ? b.points[b.points.length - 1].mentionCount - b.points[0].mentionCount : 0;
					return dropA - dropB;
				});
			case "mentions":
				return [...pool].sort((a, b) => b.totalMentions - a.totalMentions);
			case "peak":
				return [...pool].sort((a, b) => b.peak.mentionCount - a.peak.mentionCount);
			case "name":
				return [...pool].sort((a, b) => a.displayName.localeCompare(b.displayName));
		}
	}, [trajectories, sortKey]);

	const display = processed.slice(0, limit);

	if (display.length === 0) return null;

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-4">
				<SectionHeader label="ENTITY_TRAJECTORIES" count={display.length} />
				<SortDropdown value={sortKey} onChange={setSortKey} options={SORT_OPTIONS} />
			</div>
			<p className="mt-1 font-mono text-meta text-outline leading-relaxed max-w-3xl">
				Mention frequency across case documents in chronological order — surge
				or drop-off as the narrative moves forward.
			</p>
			<div className="relative bracket-top-left bracket-bottom-right">
				<div className="border border-outline-variant/30 divide-y divide-outline-variant/10">
					{display.map((t) => (
						<EntityTrajectoryRow key={t.normalizedName} trajectory={t} />
					))}
				</div>
			</div>
		</div>
	);
}
