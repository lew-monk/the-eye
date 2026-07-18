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
} from "#/components/case-detail";
import { useTRPC } from "#/integrations/trpc/react";
import type { SimilarCaseResult, CaseRelationData } from "#/integrations/trpc/routers/cases";

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
}: { open: boolean; onOpenChange: (o: boolean) => void; caseId: number }) {
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
										<span className="font-mono text-body tabular-nums text-primary/40 shrink-0">
											{caseData.caseNumber}
										</span>
										<StatusDot variant={statusVariant(caseData.status)} size="sm" />
										<span className="font-mono text-meta uppercase tracking-[0.15em] text-outline">
											{caseData.status}
										</span>
									</div>
									<h1 className="font-mono text-sm text-on-surface mb-1">
										{caseData.title}
									</h1>
									<div className="flex items-center gap-3 text-body text-outline">
										<span className="uppercase tracking-[0.12em]">{caseData.caseType}</span>
										{caseData.parties && caseData.parties.length > 0 && (
											<>
												<span className="text-outline">|</span>
												<span>{caseData.parties.join(", ")}</span>
											</>
										)}
									</div>
									{caseData.description && (
										<p className="mt-2 font-mono text-body text-on-surface-variant leading-relaxed">
											{caseData.description}
										</p>
									)}
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

						<div className="lg:grid lg:grid-cols-12 lg:gap-6 space-y-4 lg:space-y-0">
							<div className="lg:col-span-8 space-y-4">
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
																<span className="font-mono text-body text-on-surface-variant truncate">
																	{doc.filename}
																</span>
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
							</div>

							<div className="lg:col-span-4 space-y-4">
								<SectionHeader
									label="PARTICIPANTS"
									count={participants.length}
									actionLabel="ADD_PARTICIPANT"
									onAction={() => setAddParticipantOpen(true)}
									compact
								/>

								<GlassPanel variant="default" brackets="none" padding="none" className="bracket-both-compact">
									{participants.length === 0 ? (
										<EmptyStatePreset
											variant="no-entities"
											onAction={() => setAddParticipantOpen(true)}
										/>
									) : (
										<>
											<div className="divide-y divide-outline-variant/10">
												{participants.slice(0, 3).map((p) => (
													<ParticipantRow
														key={p.id}
														participant={p}
														documents={documents.map((d) => ({ id: d.id, filename: d.filename }))}
														caseId={id}
														density="compact"
													/>
												))}
											</div>
											{participants.length > 5 && (
												<>
													<Button
														variant="ghost"
														size="sm"
														brackets={false}
														className="w-full text-meta border-t border-outline-variant/10"
														onClick={() => setDrawerOpen(true)}
													>
														SHOW_ALL ({participants.length - 3} MORE)
													</Button>
													<Drawer
														open={drawerOpen}
														onOpenChange={setDrawerOpen}
														title={`ALL PARTICIPANTS — ${participants.length}`}
														size="sm"
													>
														<div className="divide-y divide-outline-variant/10">
															{participants.map((p) => (
																<ParticipantRow
																	key={p.id}
																	participant={p}
																	documents={documents.map((d) => ({ id: d.id, filename: d.filename }))}
																	caseId={id}
																	density="compact"
																/>
															))}
														</div>
													</Drawer>
												</>
											)}
										</>
									)}
								</GlassPanel>

								<CaseWideChunks caseId={id} density="compact" />
							</div>
						</div>

						{similarCases.length > 0 ? (
							<div className="mt-4 space-y-3">
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
														<span className="font-mono text-body tabular-nums text-outline">
															{sc.caseNumber}
														</span>
														{sc.title && (
															<span className="font-mono text-meta uppercase tracking-wider text-outline">
																{sc.title}
															</span>
														)}
													</div>
													<div className="flex items-center gap-2 text-meta text-outline">
														<span>{sc.documentType}</span>
														<span className="text-outline">|</span>
														<span>{sc.documentCount} DOC{sc.documentCount !== 1 ? "S" : ""}</span>
													</div>
													{sc.reasons.length > 0 && (
														<p className="font-mono text-meta text-outline truncate">
															{sc.reasons.join(" · ")}
														</p>
													)}
												</div>
												<div className="shrink-0 ml-4 text-right">
													<span className="font-mono text-body tabular-nums text-on-surface-variant">
														{(sc.score * 100).toFixed(0)}%
													</span>
												</div>
											</Link>
										))}
									</div>
								</GlassPanel>
							</div>
						) : documents.length > 0 ? (
							<div className="mt-4 space-y-3">
								<SectionHeader label="SIMILAR_CASES" count={0} />
								<GlassPanel variant="default" brackets="both" padding="none">
									<EmptyStatePreset variant="no-matches" size="sm" />
								</GlassPanel>
							</div>
						) : null}

						<div className="mt-4 space-y-3">
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
														<span className="font-mono text-body tabular-nums text-outline">
															{cr.case.caseNumber}
														</span>
														<span className="font-mono text-meta uppercase tracking-wider text-outline">
															{cr.case.title}
														</span>
													</div>
													<div className="flex items-center gap-2">
														<span className="font-mono text-meta text-outline">
															{cr.case.caseType}
														</span>
											{cr.entityName && (
												<>
													<span className="text-outline">|</span>
													<Link
														to="/entities/$entityName"
														params={{
															entityName: encodeURIComponent(
																cr.entityName.toLowerCase().replace(/\s+/g, "_"),
															),
														}}
														className="font-mono text-meta text-primary/50 hover:text-primary transition-colors"
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
						</div>
					</>
				)}

				<UploadDocumentDialog
					open={uploadOpen}
					onOpenChange={(open) => {
						setUploadOpen(open);
						if (!open) {
							queryClient.invalidateQueries(
								trpc.cases.getDocuments.queryOptions({ caseId: id }),
							);
						}
					}}
					caseId={id}
				/>

				<AddParticipantDialog
					open={addParticipantOpen}
					onOpenChange={(open) => {
						setAddParticipantOpen(open);
						if (!open) {
							queryClient.invalidateQueries(
								trpc.cases.getParticipants.queryOptions({ caseId: id }),
							);
						}
					}}
				/>
			</div>
		</AppShell>
	);
}
