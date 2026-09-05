import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import {
	Button,
	GlassPanel,
	HudDialog,
	StatusDot,
	StatusChip,
	EmptyStatePreset,
	Drawer,
} from "@workspace/ui";
import { useState, useRef } from "react";
import { AppShell } from "#/components/app-shell";
import {
	ParticipantRow,
	DocumentChunks,
	CaseWideChunks,
	AddParticipantDialog,
	SectionHeader,
	EntityTrajectoriesPanel,
	DocumentPreviewDrawer,
	documentFileUrl,
	EventChronologyTimeline,
} from "#/components/case-detail";
import { useTRPC } from "#/integrations/trpc/react";
import type {
	SimilarCaseResult,
	CaseRelationData,
	DocumentGraphData,
	RoleVarianceFlag,
	// ReferenceLink,
} from "#/integrations/trpc/routers/cases";

/* ── Color Token Map ───────────────────────────────────────
 * role colors  → roleStripColor()  → judge: tertiary, lawyer: primary, police: secondary, other: role-other
 * signal colors → StatusChip/StatusDot → success (green), warning (amber), error (destructive/red)
 * active/weight → bg-primary (teal/cyan) → WeightBar fill, active indicators
 * These groups MUST remain distinct — never reuse a role token for a signal or vice versa.
 * ──────────────────────────────────────────────────────────*/

const PRONOUN_SET = new Set([
	"i", "me", "my", "mine", "myself",
	"you", "your", "yours", "yourself",
	"he", "him", "his", "himself",
	"she", "her", "hers", "herself",
	"it", "its", "itself",
	"we", "us", "our", "ours", "ourselves",
	"they", "them", "their", "theirs", "themselves",
]);

export const Route = createFileRoute("/cases/$caseId")({
	component: CaseDetail,
});

const DOCUMENT_TYPES = [
	{ value: "judgment", label: "Judgment" },
	{ value: "court_order", label: "Court Order" },
	{ value: "contract", label: "Contract" },
	{ value: "agreement", label: "Agreement" },
	{ value: "police_report", label: "Police Report" },
	{ value: "incident_report", label: "Incident Report" },
	{ value: "witness_statement", label: "Witness Statement" },
	{ value: "affidavit", label: "Affidavit" },
	{ value: "pleading", label: "Pleading" },
	{ value: "motion", label: "Motion" },
	{ value: "brief", label: "Brief" },
	{ value: "transcript", label: "Transcript" },
	{ value: "administrative_decision", label: "Admin Decision" },
	{ value: "regulatory_filing", label: "Regulatory Filing" },
	{ value: "other", label: "Other" },
];

function UploadDocumentDialog({
	open,
	onOpenChange,
	caseId,
	onUploaded,
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	caseId: number;
	onUploaded?: () => void;
}) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [docType, setDocType] = useState("judgment");
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleUpload = async () => {
		const file = fileRef.current?.files?.[0];
		if (!file) {
			setError("Please select a file");
			return;
		}
		setUploading(true);
		setError(null);
		try {
			const formData = new FormData();
			formData.append("file", file);
			formData.append("documentType", docType);
			formData.append("caseId", String(caseId));

			const res = await fetch("/api/trpc/cases/uploadDocument", {
				method: "POST",
				body: formData,
			});
			if (!res.ok) {
				const body = await res.text();
				throw new Error(`Upload failed: ${res.status} ${body}`);
			}
			onOpenChange(false);
			onUploaded?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Upload failed");
		} finally {
			setUploading(false);
		}
	};

	return (
		<HudDialog
			open={open}
			onOpenChange={onOpenChange}
			title="UPLOAD_DOCUMENT"
			variant="form"
			size="sm"
			primaryActionLabel="UPLOAD"
			onPrimaryAction={handleUpload}
			loading={uploading}
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
						FILE
					</label>
					<input
						ref={fileRef}
						type="file"
						accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif,.bmp"
						className="w-full font-mono text-body text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:font-mono file:text-body file:uppercase file:tracking-wider file:border file:border-primary/30 file:bg-primary/5 file:text-primary hover:file:bg-primary/10 file:cursor-pointer file:transition-colors"
					/>
				</div>

				<div>
					<label className="font-mono text-body uppercase tracking-[0.12em] text-on-surface-variant block mb-1.5">
						DOCUMENT_TYPE
					</label>
					<select
						className="w-full bg-surface border border-outline text-foreground font-mono text-body px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
						value={docType}
						onChange={(e) => setDocType(e.target.value)}
					>
						{DOCUMENT_TYPES.map((dt) => (
							<option key={dt.value} value={dt.value}>
								{dt.label}
							</option>
						))}
					</select>
				</div>
			</div>
		</HudDialog>
	);
}

function CaseDetail() {
	const { caseId } = useParams({ from: "/cases/$caseId" });
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [uploadOpen, setUploadOpen] = useState(false);
	const [addParticipantOpen, setAddParticipantOpen] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [timelineOpen, setTimelineOpen] = useState(false);
	const [previewDoc, setPreviewDoc] = useState<{
		id: number;
		filename: string;
		fileType?: string | null;
		contentType?: string | null;
	} | null>(null);

	const id = Number(caseId);

	const { data: caseData, isLoading } = useQuery({
		...trpc.cases.getById.queryOptions({ id }),
		enabled: !Number.isNaN(id),
	});

	const { data: documents = [] } = useQuery({
		...trpc.cases.getDocuments.queryOptions({ caseId: id }),
		enabled: !Number.isNaN(id),
	});

	const { data: participants = [] } = useQuery({
		...trpc.cases.getParticipants.queryOptions({ caseId: id }),
		enabled: !Number.isNaN(id),
	});

	const { data: similarCases = [] } = useQuery({
		...trpc.cases.getSimilarCases.queryOptions({ caseId: id }),
		enabled: !Number.isNaN(id) && documents.length > 0,
	});

	const { data: caseRelations = [] } = useQuery({
		...trpc.cases.getCaseRelations.queryOptions({ caseId: id }),
		enabled: !Number.isNaN(id),
	});

	const { data: chronologyPreview } = useQuery({
		...trpc.cases.getDocumentChronology.queryOptions({ caseId: id, maxDates: 5 }),
		enabled: !Number.isNaN(id) && documents.length > 0,
	});

	const { data: chronologyFull } = useQuery({
		...trpc.cases.getDocumentChronology.queryOptions({ caseId: id }),
		enabled: !Number.isNaN(id) && documents.length > 0 && timelineOpen,
	});

	const { data: docGraph } = useQuery({
		...trpc.cases.getDocumentGraph.queryOptions({ caseId: id }),
		enabled: !Number.isNaN(id) && documents.length > 0,
	});

	const { data: roleFlags = [] } = useQuery({
		...trpc.cases.getRoleVarianceFlags.queryOptions({ caseId: id }),
		enabled: !Number.isNaN(id) && documents.length > 0,
	});

	const { data: trajectories = [] } = useQuery({
		...trpc.cases.getEntityTrajectories.queryOptions({ caseId: id }),
		enabled: !Number.isNaN(id) && documents.length > 0,
	});

	// const { data: referenceLinks = [] } = useQuery({
	// 	...trpc.cases.getReferenceLinks.queryOptions({ caseId: id }),
	// 	enabled: !Number.isNaN(id) && documents.length > 0,
	// });

	if (Number.isNaN(id)) {
		return (
			<AppShell>
				<div className="p-8 text-center">
					<span className="font-mono text-body text-destructive/60">INVALID_CASE_ID</span>
				</div>
			</AppShell>
		);
	}

	const statusVariant = (s: string) => {
		switch (s) {
			case "active": return "success" as const;
			case "closed": return "muted" as const;
			case "archived": return "muted" as const;
			default: return "default" as const;
		}
	};

	return (
		<AppShell>
			<div className="p-4 lg:p-6 max-w-[1400px] mx-auto space-y-4">
				<Link
					to="/"
					className="inline-flex items-center gap-1.5 font-mono text-body uppercase tracking-wider text-on-surface-variant hover:text-primary transition-colors"
				>
					<span className="text-body-lg leading-none">&larr;</span>
					BACK_TO_DASHBOARD
				</Link>

				{isLoading ? (
					<div className="py-12 text-center">
						<StatusDot variant="muted" size="md" pulse />
						<span className="font-mono text-body text-outline ml-2">
							LOADING...
						</span>
					</div>
				) : !caseData ? (
					<div className="py-12 text-center">
						<span className="font-mono text-body text-destructive/60">CASE_NOT_FOUND</span>
					</div>
				) : (
					<>
						<GlassPanel variant="default" brackets="both" padding="md">
							<div className="flex items-start justify-between gap-4">
								<div className="min-w-0">
									<div className="flex items-center gap-3 mb-2">
										<span className="font-mono text-body-lg font-bold tabular-nums text-on-surface shrink-0">
											{caseData.caseNumber}
										</span>
										<StatusDot variant={statusVariant(caseData.status)} size="sm" />
										<span className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
											{caseData.status}
										</span>
									</div>
									<h1 className="font-mono text-lg font-medium text-on-surface mb-1">
										{caseData.title}
									</h1>
									<div className="flex items-center gap-3 text-meta text-outline">
										<span className="uppercase tracking-[0.12em]">{caseData.caseType}</span>
										{caseData.parties && caseData.parties.length > 0 && (
											<>
												<span className="text-outline-variant">·</span>
												<span>{caseData.parties.join(", ")}</span>
											</>
										)}
									</div>
									{caseData.description && (
										<p className="mt-2 font-mono text-body text-on-surface reading">
											{caseData.description}
										</p>
									)}
									<Button variant="ghost" size="sm" brackets={false} className="mt-2 text-meta text-primary/70" asChild>
										<Link to="/network" search={{ caseId: id }}>
											VIEW_NETWORK
										</Link>
									</Button>
								</div>

								{caseData.tags && caseData.tags.length > 0 && (
									<div className="hidden sm:flex flex-wrap gap-1 shrink-0">
										{caseData.tags.map((tag) => (
											<span
												key={tag}
												className="font-mono text-meta uppercase tracking-wider px-2 py-0.5 border border-primary/20 text-primary/50"
											>
												{tag}
											</span>
										))}
									</div>
								)}
							</div>
						</GlassPanel>

						<div className="lg:flex lg:gap-6">
							<div className="lg:flex-1 space-y-4">
								{/* Documents */}
								<SectionHeader
									label="DOCUMENTS"
									count={documents.length}
									actionLabel="UPLOAD_DOCUMENT"
									onAction={() => setUploadOpen(true)}
								/>

								<GlassPanel variant="default" brackets="both" padding="none">
									{documents.length === 0 ? (
										<EmptyStatePreset
											variant="no-documents"
											onAction={() => setUploadOpen(true)}
										/>
									) : (
										<div className="divide-y divide-outline-variant/10">
											{documents.map((doc) => (
												<div key={doc.id}>
													<div className="flex items-center gap-4 px-5 py-3">
														<div className="flex-1 min-w-0">
															<div className="flex items-center gap-2 mb-0.5">
																{doc.storageKey ? (
																	<button
																		type="button"
																		className="font-mono text-body-lg text-on-surface truncate hover:text-primary transition-colors text-left"
																		onClick={() =>
																			setPreviewDoc({
																				id: doc.id,
																				filename: doc.filename,
																				fileType: doc.fileType,
																				contentType: doc.contentType,
																			})
																		}
																	>
																		{doc.filename}
																	</button>
																) : (
																	<span className="font-mono text-body-lg text-on-surface truncate">
																		{doc.filename}
																	</span>
																)}
																<span className="font-mono text-meta text-outline shrink-0 uppercase">
																	{doc.fileType}
																</span>
															</div>
															<div className="flex items-center gap-2 text-meta text-outline">
																<span>{doc.documentType}</span>
																<span className="text-outline">|</span>
																<span>{(doc.fileSize / 1024).toFixed(0)} KB</span>
															</div>
														</div>
													{doc.storageKey && (
														<div className="flex items-center gap-1 shrink-0">
															<Button
																variant="ghost"
																size="sm"
																brackets={false}
																className="text-meta uppercase tracking-wider text-primary/70 hover:text-primary"
																onClick={() =>
																	setPreviewDoc({
																		id: doc.id,
																		filename: doc.filename,
																		fileType: doc.fileType,
																		contentType: doc.contentType,
																	})
																}
															>
																VIEW
															</Button>
															<Button
																variant="ghost"
																size="sm"
																brackets={false}
																className="text-meta uppercase tracking-wider text-primary/70 hover:text-primary"
																asChild
															>
																<a
																	href={documentFileUrl(doc.id, "attachment")}
																	download={doc.filename}
																	onClick={(e) => e.stopPropagation()}
																>
																	DOWNLOAD
																</a>
															</Button>
														</div>
													)}
													<StatusDot
														variant={
															doc.status === "completed" || doc.status === "processed"
																? "success"
																: doc.status === "failed"
																	? "error"
																	: doc.status === "processing" || doc.status === "queued"
																		? "warning"
																		: "muted"
														}
														size="sm"
													/>
													<span className="font-mono text-meta uppercase tracking-wider text-outline shrink-0">
														{doc.status}
													</span>
												</div>
													<DocumentChunks documentId={doc.id} density="standard" />
												</div>
											))}
										</div>
									)}
								</GlassPanel>

								{/* Similar Cases — left area */}
								{similarCases.length > 0 ? (
									<>
										<SectionHeader
											label="SIMILAR_CASES"
											count={similarCases.length}
										/>
										<GlassPanel variant="default" brackets="both" padding="none">
											<div className="divide-y divide-outline-variant/10">
												{similarCases.map((sc: SimilarCaseResult) => (
													<Link
														key={sc.caseNumber}
														to="/cases/$caseId"
														params={{ caseId: String(sc.caseId) }}
														className="flex items-center justify-between px-5 py-3 hover:bg-surface/50 transition-colors block"
													>
														<div className="min-w-0 flex-1">
															<div className="flex items-center gap-2 mb-0.5">
																<span className="font-mono text-body-lg tabular-nums text-on-surface">
																	{sc.caseNumber}
																</span>
																{sc.title && (
																	<span className="font-mono text-body text-on-surface truncate">
																		{sc.title}
																	</span>
																)}
															</div>
															<div className="flex items-center gap-2 text-meta text-outline">
																<span>{sc.documentType}</span>
																<span className="text-outline-variant">·</span>
																<span>{sc.documentCount} doc{sc.documentCount !== 1 ? "s" : ""}</span>
															</div>
															{sc.reasons.length > 0 && (
																<p className="font-mono text-body text-on-surface reading truncate">
																	{sc.reasons[0]}
																</p>
															)}
														</div>
														<div className="shrink-0 ml-4 text-right">
															<span className="font-mono text-body-lg font-bold tabular-nums text-on-surface">
																{(sc.score * 100).toFixed(0)}%
															</span>
														</div>
													</Link>
												))}
											</div>
										</GlassPanel>
									</>
								) : documents.length > 0 ? (
									<>
										<SectionHeader label="SIMILAR_CASES" count={0} />
										<GlassPanel variant="default" brackets="both" padding="none">
											<EmptyStatePreset variant="no-matches" size="sm" />
										</GlassPanel>
									</>
								) : null}

								{/* Chronology */}
								{documents.length > 0 && (
									<>
										<SectionHeader
											label="EVENT_CHRONOLOGY"
											count={chronologyPreview?.totalDates ?? 0}
										/>
										<GlassPanel variant="default" brackets="both" padding="none">
											{!chronologyPreview || chronologyPreview.events.length === 0 ? (
												<EmptyStatePreset
													variant="no-matches"
													size="sm"
													heading="NO_DATES_IN_FILES"
													body="Dates written in the documents will appear here as a case timeline."
												/>
											) : (
												<>
													<EventChronologyTimeline events={chronologyPreview.events} />
													{chronologyPreview.totalDates > 5 && (
														<Button
															variant="ghost"
															size="sm"
															brackets={false}
															className="w-full text-meta border-t border-outline-variant/10"
															onClick={() => setTimelineOpen(true)}
														>
															SHOW_MORE ({chronologyPreview.totalDates - 5} EARLIER DATES)
														</Button>
													)}
												</>
											)}
										</GlassPanel>
										<Drawer
											open={timelineOpen}
											onOpenChange={setTimelineOpen}
											title={`CASE TIMELINE — ${chronologyPreview?.totalDates ?? 0} DATES`}
											size="xl"
											bodyClassName="p-0"
										>
											{chronologyFull ? (
												<EventChronologyTimeline events={chronologyFull.events} />
											) : (
												<div className="px-5 py-8 font-mono text-body text-outline">
													LOADING_TIMELINE
												</div>
											)}
										</Drawer>
									</>
								)}

								{/* Role Variance */}
								{roleFlags.length > 0 && (
									<>
										<SectionHeader label="ROLE_VARIANCE" count={roleFlags.length} />
										<GlassPanel variant="default" brackets="both" padding="none">
											<div className="divide-y divide-outline-variant/10">
												{roleFlags.map((f: RoleVarianceFlag) => (
													<div key={f.normalizedName} className="px-5 py-3">
														<div className="flex items-center gap-2 mb-1">
															<Link
																to="/entities/$entityName"
																params={{
																	entityName: encodeURIComponent(f.normalizedName),
																}}
																className="font-mono text-body-lg text-on-surface hover:text-primary"
															>
																{f.displayName}
															</Link>
															<StatusChip variant="warning" size="sm">
																{f.primaryRole}
															</StatusChip>
														</div>
														<p className="font-mono text-body text-on-surface reading">{f.flag}</p>
														<div className="flex flex-wrap gap-1 mt-1.5">
															{f.roles.map((r) => (
																<span
																	key={r.role}
																	className="font-mono text-meta text-outline border border-outline-variant/30 px-1.5 py-0.5"
																>
																	{r.role} ×{r.count}
																</span>
															))}
														</div>
													</div>
												))}
											</div>
										</GlassPanel>
									</>
								)}
							</div>

							<div className="lg:flex-1 space-y-4">
								{/* Participants */}
								<SectionHeader
									label="PARTICIPANTS"
									count={participants.length}
									actionLabel="ADD_PARTICIPANT"
									onAction={() => setAddParticipantOpen(true)}
									compact
								/>

								{(() => {
									const sorted = [...participants].sort((a, b) => {
										const aPronoun = a.role === "other" && PRONOUN_SET.has(a.name.toLowerCase());
										const bPronoun = b.role === "other" && PRONOUN_SET.has(b.name.toLowerCase());
										if (aPronoun && !bPronoun) return 1;
										if (!aPronoun && bPronoun) return -1;
										return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
									});
									return (
										<GlassPanel variant="default" brackets="none" padding="none" className="bracket-both-compact">
											{sorted.length === 0 ? (
												<EmptyStatePreset
													variant="no-entities"
													onAction={() => setAddParticipantOpen(true)}
												/>
											) : (
												<>
													<div className="divide-y divide-outline-variant/10">
														{sorted.slice(0, 3).map((p) => (
															<ParticipantRow
																key={p.id}
																participant={p}
																documents={documents.map((d) => ({ id: d.id, filename: d.filename }))}
																caseId={id}
																density="compact"
															/>
														))}
													</div>
													{sorted.length > 5 && (
														<>
															<Button
																variant="ghost"
																size="sm"
																brackets={false}
																className="w-full text-meta border-t border-outline-variant/10"
																onClick={() => setDrawerOpen(true)}
															>
																SHOW_ALL ({sorted.length - 3} MORE)
															</Button>
															<Drawer
																open={drawerOpen}
																onOpenChange={setDrawerOpen}
																title={`ALL PARTICIPANTS — ${sorted.length}`}
																size="sm"
															>
																<div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-outline-variant/10">
																	{sorted.map((p) => (
																		<ParticipantRow
																			key={p.id}
																			participant={p}
																			documents={documents.map((d) => ({ id: d.id, filename: d.filename }))}
																			caseId={id}
																			density="compact"
																			className="bg-surface"
																		/>
																	))}
																</div>
															</Drawer>
														</>
													)}
												</>
											)}
										</GlassPanel>
									);
								})()}

								{/* Case-wide Chunks — right column */}
								<CaseWideChunks caseId={id} density="compact" />

								{/* Connected Cases */}
								<SectionHeader
									label="CONNECTED_CASES"
									count={caseRelations.length}
								/>
								<GlassPanel variant="default" brackets="both" padding="none">
									{caseRelations.length === 0 ? (
										<EmptyStatePreset
											variant="no-matches"
											size="sm"
											heading="NO_CONNECTED_CASES"
											body="Shared entities between cases will appear here after document processing."
										/>
									) : (
										<div className="divide-y divide-outline-variant/10">
											{caseRelations.map((cr: CaseRelationData, i: number) => (
												<Link
													key={`${cr.case.id}-${i}`}
													to="/cases/$caseId"
													params={{ caseId: String(cr.case.id) }}
													className="flex items-center justify-between px-5 py-3 hover:bg-surface/50 transition-colors block"
												>
													<div className="min-w-0 flex-1">
														<div className="flex items-center gap-2 mb-0.5">
															<span className="font-mono text-body-lg tabular-nums text-on-surface">
																{cr.case.caseNumber}
															</span>
															<span className="font-mono text-body text-on-surface truncate">
																{cr.case.title}
															</span>
														</div>
														<div className="flex items-center gap-2">
															<span className="font-mono text-meta text-outline">
																{cr.case.caseType}
															</span>
												{cr.entityName && (
													<>
														<span className="text-outline-variant">·</span>
														<Link
															to="/entities/$entityName"
															params={{
																entityName: encodeURIComponent(
																	cr.entityName.toLowerCase().replace(/\s+/g, "_"),
																),
															}}
															className="font-mono text-meta text-primary/70 hover:text-primary transition-colors"
														>
															{cr.entityName}
														</Link>
													</>
												)}
														</div>
													</div>
													<div className="shrink-0 ml-4">
														<StatusChip variant="secondary" size="sm">
															{cr.relationType}
														</StatusChip>
													</div>
												</Link>
											))}
										</div>
									)}
								</GlassPanel>

								{/* Document Graph */}
								{documents.length > 0 && (
									<>
										<SectionHeader
											label="DOCUMENT_GRAPH"
											count={(docGraph?.edges.length ?? 0) + (docGraph?.nodes.length ?? 0)}
										/>
										<GlassPanel variant="default" brackets="both" padding="none">
											{!docGraph || (docGraph.edges.length === 0 && docGraph.nodes.length === 0) ? (
												<EmptyStatePreset
													variant="no-matches"
													size="sm"
													heading="NO_CROSS_REFS"
													body="Explicit references, type hierarchy, and file dates will appear here."
												/>
											) : (
												<div className="divide-y divide-outline-variant/10">
													{(docGraph as DocumentGraphData).nodes.map((node) => (
														<div key={node.documentId} className="px-5 py-3">
															<div className="flex items-center gap-2 mb-1">
																<span className="font-mono text-body-lg text-on-surface truncate">
																	{node.filename}
																</span>
																<span className="font-mono text-meta uppercase tracking-wider text-outline">
																	{node.documentType}
																</span>
															</div>
															{node.dates && node.dates.length > 0 ? (
																<div className="flex flex-wrap gap-1">
																	{node.dates.map((d) => (
																		<span
																			key={`${node.documentId}-${d.date}-${d.kind}`}
																			className="font-mono text-meta-sm text-on-surface bg-primary/[0.08] px-1.5 py-0.5"
																		>
																			{d.date} · {d.kind}
																		</span>
																	))}
																</div>
															) : (
																<span className="font-mono text-meta text-outline">
																	NO_DATES_IN_FILE
																</span>
															)}
														</div>
													))}
													{(docGraph as DocumentGraphData).edges.map((edge, i) => {
														const src = docGraph.nodes.find(
															(n) => n.documentId === edge.sourceDocumentId,
														);
														const tgt = docGraph.nodes.find(
															(n) => n.documentId === edge.targetDocumentId,
														);
														return (
															<div key={`e-${i}`} className="px-5 py-3">
																<div className="flex items-center gap-2 flex-wrap">
																	<span className="font-mono text-body text-on-surface">
																		{src?.filename ?? edge.sourceDocumentId}
																	</span>
																	<span className="font-mono text-meta text-outline">
																		→
																	</span>
																	<span className="font-mono text-body text-on-surface">
																		{tgt?.filename ?? edge.targetDocumentId}
																	</span>
																</div>
																<div className="flex items-center gap-2 mt-1">
																	<StatusChip
																		variant={
																			edge.relationType === "explicit_reference"
																				? "default"
																				: "muted"
																		}
																		size="sm"
																	>
																		{edge.relationType}
																	</StatusChip>
																	<span className="font-mono text-meta text-outline truncate">
																		{edge.label}
																	</span>
																</div>
															</div>
														);
													})}
												</div>
											)}
										</GlassPanel>
									</>
								)}

								{/* REFERENCE_LINKS tile hidden until linker is ready
								{referenceLinks.length > 0 && (
									<>
										<SectionHeader
											label="REFERENCE_LINKS"
											count={referenceLinks.length}
										/>
										...
									</>
								)}
								*/}
							</div>
						</div>

						{/* Entity Trajectories — full width below the columns */}
						{trajectories.length > 0 && (
							<div>
								<EntityTrajectoriesPanel trajectories={trajectories} />
							</div>
						)}
					</>
				)}

				<UploadDocumentDialog
					open={uploadOpen}
					onOpenChange={setUploadOpen}
					caseId={id}
					onUploaded={() => {
						queryClient.invalidateQueries(
							trpc.cases.getDocuments.queryOptions({ caseId: id }),
						);
						queryClient.invalidateQueries(
							trpc.cases.getById.queryOptions({ id }),
						);
					}}
				/>

				<AddParticipantDialog
					open={addParticipantOpen}
					onOpenChange={setAddParticipantOpen}
					caseId={id}
					documents={documents.map((d) => ({ id: d.id, filename: d.filename }))}
				/>

				<DocumentPreviewDrawer
					open={previewDoc != null}
					onOpenChange={(open) => {
						if (!open) setPreviewDoc(null);
					}}
					document={previewDoc}
				/>
			</div>
		</AppShell>
	);
}
