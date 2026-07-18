import { useState } from "react";
import { WeightBar, StatusDot, StatusChip, HudDialog, Button, EmptyStatePreset } from "@workspace/ui";
import type {
	ParticipantEntity,
	ChunkData,
	CaseChunkData,
	EntitySearchResult,
	EntityConfidence,
} from "#/integrations/trpc/routers/cases";
import { useTRPC } from "#/integrations/trpc/react";
import { useQuery } from "@tanstack/react-query";
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

function roleStripColor(role: string): string {
	return ROLE_STRIP_COLORS[role] ?? "var(--role-other)";
}

function roleLabel(role: string): string {
	return ROLE_LABELS[role] ?? role.toUpperCase().replace(/_/g, "_");
}

function firstThreeSentences(text: string): { excerpt: string; hasMore: boolean } {
	const sentences = text.match(/[^.!?]+[.!?]+/g);
	if (!sentences || sentences.length === 0) {
		return { excerpt: text.slice(0, 200).trim(), hasMore: text.length > 200 };
	}
	const first3 = sentences.slice(0, 3).join("").trim();
	const hasMore = sentences.length > 3 || text.length > first3.length + 5;
	return { excerpt: first3, hasMore };
}

export function SectionHeader({
	label,
	count,
	actionLabel,
	onAction,
	compact,
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
				<span
					className={`font-mono uppercase tracking-[0.15em] ${
						compact
							? "text-meta text-outline"
							: "text-body text-outline"
					}`}
				>
					{label}
				</span>
				<span className={`font-mono text-body text-outline`}>{count}</span>
			</div>
			{actionLabel && onAction && (
				<Button variant="default" size="sm" onClick={onAction}>
					{actionLabel}
				</Button>
			)}
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
	console.log('mentions', participant.normalizedName, "======")

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
						<div className="flex items-center gap-2 mb-0.5">
							<Link
								to="/entities/$entityName"
								params={{ entityName: encodeURIComponent(participant.normalizedName) }}
								className={`font-mono text-on-surface-variant hover:text-primary transition-colors ${
									compact ? "text-body" : "text-body"
								}`}
								onClick={(e: React.MouseEvent) => e.stopPropagation()}
							>
								{participant.name}
							</Link>
							{participant.confidence && (
								<StatusChip
									variant={
										participant.confidence.score >= 80
											? "success"
											: participant.confidence.score >= 50
												? "warning"
												: "error"
									}
									size="sm"
								>
									{participant.confidence.score}%
								</StatusChip>
							)}
							{isManual && (
								<span className="font-mono text-meta-sm uppercase tracking-wider px-1.5 py-0.5 border border-outline-variant/50 text-outline">
									MANUAL
								</span>
							)}
						</div>

						<div
							className={`font-mono uppercase tracking-[0.12em] text-outline ${
								compact ? "text-meta-sm mb-1" : "text-meta mb-1.5"
							}`}
						>
							{roleLabel(participant.role)}
						</div>

						{mentions.length > 0 && (
							<div className={`flex items-center gap-1 flex-wrap ${compact ? "mb-1" : "mb-1.5"}`}>
								{mentions.slice(0, 5).map((m) => (
									<span
										key={m}
										className={`font-mono text-outline border border-outline-variant/30 px-1.5 py-0.5 truncate max-w-[180px] ${
											compact ? "text-meta-sm" : "text-meta-sm"
										}`}
									>
										{m}
									</span>
								))}
								{mentions.length > 5 && (
									<span className={`font-mono text-outline ${compact ? "text-meta-sm" : "text-meta-sm"}`}>
										+{mentions.length - 5}
									</span>
								)}
							</div>
						)}

						{participant.confidence && participant.confidence.flags.length > 0 && (
							<div className={`${compact ? "text-meta-sm" : "text-meta-sm"} font-mono text-warning/50 mb-1`}>
								{participant.confidence.flags.slice(0, 1).join(" · ")}
							</div>
						)}

						<div className="flex items-center gap-4">
							<WeightBar value={score} density={density} className="flex-1 max-w-[320px]" />
						</div>

<div className={`flex items-center gap-2 mt-1 text-outline ${compact ? "text-meta-sm" : "text-meta"}`}>
							<span>MENTIONS: {participant.mentionCount}</span>
							<span className="text-outline">|</span>
							<span>
								{participant.documentCount} DOC
								{participant.documentCount !== 1 ? "S" : ""}
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

			{expanded && mentions.length > 0 && (
				<div className="border-t border-outline-variant/10">
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
											<span className={`font-mono text-primary/60 ${compact ? "text-meta" : "text-body"}`}>
												→
											</span>
											<span
												className={`font-mono text-on-surface-variant truncate ${
													compact ? "text-meta" : "text-body"
												}`}
											>
												{docName}
											</span>
										</div>
										{mention && (
											<p className={`font-mono text-outline leading-relaxed line-clamp-2 mt-0.5 ${compact ? "text-meta-sm" : "text-meta"}`}>
												{mention}
											</p>
										)}
									</div>
									<button
										type="button"
										className={`font-mono uppercase tracking-wider text-primary/40 hover:text-primary transition-colors border-none bg-transparent cursor-pointer shrink-0 mt-0.5 ${compact ? "text-meta-sm" : "text-meta"}`}
										onClick={(e) => {
											e.stopPropagation();
											setActiveMentionIdx(isActive ? null : i);
										}}
									>
										VIEW_CHUNK →
									</button>
								</div>
				
								{isActive && (
									<div className={`mt-2 border border-primary/20 bg-primary/5 ${compact ? "p-2" : "p-3"}`}>
										<div className="flex items-center justify-between mb-1.5">
											<span className={`font-mono uppercase tracking-[0.1em] text-primary/40 ${compact ? "text-meta-sm" : "text-meta-sm"}`}>
												CONTEXT_LENS
											</span>
											{activeContext && (
												<span className={`font-mono text-outline ${compact ? "text-meta-sm" : "text-meta-sm"}`}>
													POS: [{activeContext.start}..{activeContext.end}]
												</span>
											)}
										</div>
										{activeContext ? (
											<>
												{activeContext.filename && (
													<span className={`block font-mono uppercase tracking-[0.1em] text-primary/30 mb-1 ${compact ? "text-meta-sm" : "text-meta-sm"}`}>
														{activeContext.filename}
													</span>
												)}
												<p className={`font-mono text-on-surface-variant leading-relaxed ${compact ? "text-meta-sm" : "text-meta"}`}>
													{(() => {
														const ctx = activeContext.context
														const hasLeadingEllipsis = ctx.startsWith('\u2026')
														const clean = hasLeadingEllipsis ? ctx.slice(1) : ctx
														const offset = Math.min(150, activeContext.start)
														const mentionLen = activeContext.text.length
														const prefix = hasLeadingEllipsis ? '\u2026' : ''
														return (
															<>
																<span className="text-outline">{prefix}{clean.slice(0, offset)}</span>
																<mark className="text-primary/80 bg-primary/15 px-0.5">{clean.slice(offset, offset + mentionLen)}</mark>
																<span className="text-outline">{clean.slice(offset + mentionLen)}</span>
															</>
														)
													})()}
												</p>
											</>
										) : (
											<p className={`font-mono text-on-surface-variant leading-relaxed ${compact ? "text-meta-sm" : "text-meta"}`}>
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
								<div
									className={`${
										compact ? "px-3 py-1.5" : "px-5 py-2"
									} text-center cursor-pointer hover:bg-surface/50 transition-colors border-t border-outline-variant/10`}
									onClick={(e) => {
										e.stopPropagation();
										setShowAll(true);
									}}
								>
									<span
										className={`font-mono uppercase tracking-[0.12em] text-primary/50 hover:text-primary transition-colors ${
											compact ? "text-meta-sm" : "text-meta"
										}`}
									>
										SHOW_MORE ({chunks.length - 5} REMAINING)
									</span>
								</div>
							)}
						</>
					)}
				</div>
			)}
		</div>
	);
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
	const weight = chunk.positionWeight ?? 0;
	const { excerpt, hasMore } = firstThreeSentences(chunk.text);
	const displayIndex = String(index + 1).padStart(2, "0");
	const compact = density === "compact";

	return (
		<div
			className={`${
				compact ? "px-3 py-2" : "px-5 py-3"
			} border-b border-outline-variant/10 last:border-b-0`}
		>
			<div className="flex items-center gap-3 mb-1">
				<span
					className={`font-mono text-outline tabular-nums shrink-0 ${
						compact ? "text-meta-sm w-4" : "text-meta w-5"
					}`}
				>
					{displayIndex}
				</span>
				<WeightBar value={weight} density={density} className="flex-1 max-w-[320px]" />
			</div>
			{sourceFilename && (
				<p className={`font-mono text-outline truncate ${compact ? "text-meta-sm mb-0.5 pl-6" : "text-meta mb-0.5 pl-8"}`}>
					{sourceFilename}
				</p>
			)}
			<p
				className={`font-mono text-on-surface-variant leading-relaxed ${
					compact ? "text-meta pl-6" : "text-body pl-8"
				}`}
			>
				{excerpt}
				{hasMore && <span className="text-outline">…</span>}
			</p>
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
							<div
								className={`${
									compact ? "px-3 py-1.5" : "px-5 py-2"
								} text-center cursor-pointer hover:bg-surface/50 transition-colors border-t border-outline-variant/10`}
								onClick={() => setShowAll(true)}
							>
								<span
									className={`font-mono uppercase tracking-[0.12em] text-primary/50 hover:text-primary transition-colors ${
										compact ? "text-meta-sm" : "text-meta"
									}`}
								>
									SHOW_MORE ({chunks.length - 5} REMAINING)
								</span>
							</div>
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
}

export function AddParticipantDialog({ open, onOpenChange }: AddParticipantDialogProps) {
	const [name, setName] = useState("");
	const [role, setRole] = useState("other");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleAdd = async () => {
		if (!name.trim()) {
			setError("Name is required");
			return;
		}
		setSaving(true);
		setError(null);

		setTimeout(() => {
			setSaving(false);
			onOpenChange(false);
			setName("");
			setRole("other");
		}, 300);
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
			loading={saving}
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
			</div>
		</HudDialog>
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
										<span className="font-mono text-body text-on-surface-variant">
											{entity.name}
										</span>
										<span className="font-mono text-meta-sm uppercase tracking-wider px-1 py-0.5 border border-outline-variant/50 text-outline">
											{entity.role}
										</span>
									</div>
<div className="flex items-center gap-2 text-meta text-outline">
										{entity.caseNumber && (
											<>
												<span className="text-primary/40">{entity.caseNumber}</span>
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
