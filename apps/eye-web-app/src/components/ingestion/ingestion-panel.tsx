import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Button,
	GlassPanel,
	InputField,
	StatusChip,
	StatusDot,
	WeightBar,
} from "@workspace/ui";
import { useRef, useState } from "react";
import { useTRPC } from "#/integrations/trpc/react";
import type {
	IngestionJobData,
	QueueStatusData,
} from "#/integrations/trpc/routers/ingestion";
import { apiClient } from "#/lib/api-client";
import {
	formatBytes,
	isSupportedUploadFile,
	jobProgress,
	jobStatusChipVariant,
	UPLOAD_ACCEPT_ATTR,
} from "./ingestion-helpers";
import { NewIngestionDialog } from "./new-ingestion-dialog";
import {
	liveFileStates,
	type StreamedJobEvent,
	useJobEvents,
} from "./use-job-events";

const DOCUMENT_TYPES = [
	{ value: "judgment", label: "Judgment" },
	{ value: "court_order", label: "Court Order" },
	{ value: "pleading", label: "Pleading" },
	{ value: "motion", label: "Motion" },
	{ value: "brief", label: "Brief" },
	{ value: "transcript", label: "Transcript" },
	{ value: "other", label: "Other" },
];

function FileUploadCard({ onUploaded }: { onUploaded?: () => void }) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [docType, setDocType] = useState("judgment");
	const [caseId, setCaseId] = useState("");
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);

	const handleUpload = async () => {
		const file = fileRef.current?.files?.[0];
		if (!file) {
			setError("Please select a file");
			return;
		}
		if (!isSupportedUploadFile(file.name)) {
			setError(`Unsupported file type: ${file.name}`);
			return;
		}
		setUploading(true);
		setError(null);
		setDone(null);
		try {
			const formData = new FormData();
			formData.append("file", file);
			formData.append("documentType", docType);
			if (caseId.trim()) formData.append("caseId", caseId.trim());

			const res = await apiClient.postFormData<{
				success?: boolean;
				documentId?: number;
			}>("/api/upload/queue", formData);
			setDone(
				`${file.name} queued for processing${res.documentId ? ` (#${res.documentId})` : ""}`,
			);
			if (fileRef.current) fileRef.current.value = "";
			onUploaded?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Upload failed");
		} finally {
			setUploading(false);
		}
	};

	return (
		<GlassPanel variant="default" brackets="both" padding="md">
			<div className="flex items-center gap-2 mb-4">
				<StatusDot variant="default" size="sm" />
				<span className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
					FILE_UPLOAD
				</span>
			</div>

			{error && (
				<div className="border border-destructive/30 bg-destructive/5 p-2 flex items-center gap-2 mb-3">
					<StatusDot variant="error" size="sm" />
					<span className="font-mono text-body text-destructive/70">
						{error}
					</span>
				</div>
			)}
			{done && (
				<div className="border border-primary/30 bg-primary/5 p-2 flex items-center gap-2 mb-3">
					<StatusDot variant="success" size="sm" />
					<span className="font-mono text-body text-primary/80">{done}</span>
				</div>
			)}

			<div className="space-y-3">
				<div>
					<label
						htmlFor="ingest-file"
						className="font-mono text-body uppercase tracking-[0.12em] text-on-surface-variant block mb-1.5"
					>
						FILE
					</label>
					<input
						id="ingest-file"
						ref={fileRef}
						type="file"
						accept={UPLOAD_ACCEPT_ATTR}
						className="w-full font-mono text-body text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:font-mono file:text-body file:uppercase file:tracking-wider file:border file:border-primary/30 file:bg-primary/5 file:text-primary hover:file:bg-primary/10 file:cursor-pointer file:transition-colors"
					/>
					<p className="font-mono text-meta text-outline mt-1">
						PDF,_PNG,_JPG,_TIFF,_BMP._MAX_200MB.
					</p>
				</div>

				<div>
					<label
						htmlFor="ingest-doctype"
						className="font-mono text-body uppercase tracking-[0.12em] text-on-surface-variant block mb-1.5"
					>
						DOCUMENT_TYPE
					</label>
					<select
						id="ingest-doctype"
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

				<InputField
					label="CASE_ID (OPTIONAL)"
					type="text"
					inputMode="numeric"
					placeholder="e.g. 12"
					value={caseId}
					onChange={(e) => setCaseId(e.target.value.replace(/[^0-9]/g, ""))}
				/>

				<Button
					variant="default"
					size="sm"
					disabled={uploading}
					onClick={handleUpload}
				>
					{uploading ? "UPLOADING…" : "UPLOAD_FILE"}
				</Button>
			</div>
		</GlassPanel>
	);
}

function JobFiles({
	jobId,
	liveEvents,
}: {
	jobId: string;
	liveEvents: StreamedJobEvent[];
}) {
	const trpc = useTRPC();
	const { data: files = [], isLoading } = useQuery({
		...trpc.ingestion.listFiles.queryOptions({ id: jobId }),
		staleTime: 10_000,
	});
	const liveStates = liveFileStates(liveEvents);

	if (isLoading) {
		return (
			<div className="py-3 text-center">
				<StatusDot variant="muted" size="md" pulse />
				<span className="font-mono text-body text-outline ml-2">
					LOADING_FILES…
				</span>
			</div>
		);
	}

	if (files.length === 0) {
		return (
			<p className="font-mono text-meta text-outline py-2">
				NO_FILES_INDEXED_YET
			</p>
		);
	}

	return (
		<div className="divide-y divide-outline-variant/10">
			{files.slice(0, 50).map((f) => {
				const live = liveStates.get(f.checksum);
				const status =
					live?.kind === "file-done"
						? "summarized"
						: live?.kind === "file-failed"
							? "failed"
							: f.status;
				const stageLabel = live?.stage
					? live.kind === "file-done"
						? "PROCESSED"
						: `${live.stage.toUpperCase()}${live.pct !== undefined ? ` ${live.pct}%` : ""}`
					: null;
				return (
					<div key={f.checksum} className="flex items-center gap-3 py-1.5">
						<StatusDot
							variant={
								status === "failed"
									? "error"
									: status === "summarized"
										? "success"
										: "default"
							}
							size="sm"
							pulse={live?.kind === "file-progress"}
						/>
						<span className="font-mono text-body text-on-surface truncate flex-1">
							{f.relativePath}
						</span>
						<span className="font-mono text-meta tabular-nums text-outline shrink-0">
							{formatBytes(f.sizeBytes)}
						</span>
						{stageLabel && (
							<span className="font-mono text-meta tabular-nums text-primary/70 shrink-0">
								{stageLabel}
							</span>
						)}
						<StatusChip
							variant={status === "failed" ? "error" : "muted"}
							size="sm"
						>
							{status.toUpperCase().slice(0, 8)}
						</StatusChip>
					</div>
				);
			})}
			{files.length > 50 && (
				<p className="font-mono text-meta text-outline py-1">
					+{files.length - 50} MORE
				</p>
			)}
		</div>
	);
}

function JobRow({ job }: { job: IngestionJobData }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [expanded, setExpanded] = useState(false);
	const [requeueNote, setRequeueNote] = useState<string | null>(null);
	const progress = jobProgress(job);
	const { events: liveEvents, live } = useJobEvents(expanded ? job.id : null);
	const unfinished = job.totalFiles - job.doneFiles - job.failedFiles;

	const requeueMutation = useMutation({
		...trpc.ingestion.enqueue.mutationOptions(),
		onSuccess: (result) => {
			setRequeueNote(`QUEUED ${result?.enqueued ?? 0} FILES`);
			queryClient.invalidateQueries(trpc.ingestion.list.queryOptions());
		},
		onError: (err) => {
			setRequeueNote(err instanceof Error ? err.message : "Requeue failed");
		},
	});

	return (
		<div className="border border-outline-variant/20 hover:border-primary/20 transition-colors">
			<div className="px-4 py-3">
				<div className="flex items-center gap-3 min-w-0">
					<StatusChip variant={jobStatusChipVariant(job.status)} size="sm">
						{job.status.toUpperCase()}
					</StatusChip>
					<StatusChip variant="secondary" size="sm">
						{(job.collection ?? "judgments").toUpperCase().slice(0, 12)}
					</StatusChip>
					<span className="font-mono text-body text-on-surface truncate flex-1">
						{job.source} :: {job.root}
					</span>
					<span className="font-mono text-meta tabular-nums text-outline shrink-0">
						{job.doneFiles + job.failedFiles}/{job.totalFiles} FILES
					</span>
					{expanded && (
						<span className="flex items-center gap-1.5 shrink-0">
							<StatusDot
								variant={live ? "success" : "muted"}
								size="sm"
								pulse={live}
							/>
							<span className="font-mono text-meta text-outline">
								{live ? "LIVE" : "POLLING"}
							</span>
						</span>
					)}
					<Button
						variant="ghost"
						size="sm"
						brackets={false}
						className="text-primary/50"
						onClick={() => setExpanded((v) => !v)}
					>
						{expanded ? "HIDE_FILES" : "VIEW_FILES"} →
					</Button>
					{unfinished > 0 && (
						<Button
							variant="ghost"
							size="sm"
							brackets={false}
							className="text-primary/50"
							disabled={requeueMutation.isPending}
							onClick={() => {
								setRequeueNote(null);
								requeueMutation.mutate({ id: job.id });
							}}
						>
							{requeueMutation.isPending ? "QUEUING…" : "REQUEUE"} →
						</Button>
					)}
				</div>
				<div className="mt-2">
					<WeightBar value={progress} density="standard" />
				</div>
				<div className="flex items-center gap-3 mt-1.5">
					<span className="font-mono text-meta tabular-nums text-outline">
						{formatBytes(job.transferredBytes)} / {formatBytes(job.totalBytes)}
					</span>
					{job.failedFiles > 0 && (
						<span className="font-mono text-meta text-destructive/70">
							{job.failedFiles} FAILED
						</span>
					)}
					{job.lastError && (
						<span className="font-mono text-meta text-destructive/70 truncate">
							{job.lastError}
						</span>
					)}
					{requeueNote && (
						<span className="font-mono text-meta text-primary/70 truncate">
							{requeueNote}
						</span>
					)}
				</div>
			</div>
			{expanded && (
				<div className="px-4 pb-3 border-t border-outline-variant/10">
					<JobFiles jobId={job.id} liveEvents={liveEvents} />
				</div>
			)}
		</div>
	);
}

export function QueueStatusStrip({ queues }: { queues: QueueStatusData[] }) {
	if (queues.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-outline-variant/20 px-3 py-1.5">
			<span className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
				WORKER_QUEUES
			</span>
			{queues.map((q) => {
				const idle = q.counts.waiting > 0 && q.counts.active === 0;
				return (
					<span
						key={q.queue}
						className="flex items-center gap-1.5 font-mono text-meta tabular-nums"
					>
						<StatusDot
							variant={
								q.counts.failed > 0
									? "error"
									: q.counts.active > 0
										? "success"
										: idle
											? "warning"
											: "muted"
							}
							size="sm"
							pulse={q.counts.active > 0}
						/>
						<span className="text-outline">
							{q.collection.toUpperCase()}::{q.counts.waiting} WAIT ::
							{q.counts.active} ACTIVE
							{q.counts.failed > 0 && (
								<span className="text-destructive/70">
									::{q.counts.failed} FAIL
								</span>
							)}
							{idle && (
								<span className="text-amber-400/80">::WAITING_FOR_WORKER</span>
							)}
						</span>
					</span>
				);
			})}
		</div>
	);
}

export function IngestionPanel() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);

	const { data: jobs = [], isLoading } = useQuery({
		...trpc.ingestion.list.queryOptions(),
		staleTime: 5_000,
		refetchInterval: (query) => {
			const data = query.state.data as IngestionJobData[] | undefined;
			const active = (data ?? []).some((j) =>
				["pending", "discovering", "transferring", "processing"].includes(
					j.status,
				),
			);
			return active ? 3_000 : false;
		},
	});

	const { data: queues = [] } = useQuery({
		...trpc.ingestion.queueStatus.queryOptions(),
		staleTime: 5_000,
		refetchInterval: 5_000,
	});

	const refreshMutation = useMutation({
		mutationFn: async () => {
			await queryClient.invalidateQueries({
				queryKey: trpc.ingestion.list.queryKey(),
			});
		},
	});

	return (
		<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
			<div className="lg:col-span-1">
				<FileUploadCard
					onUploaded={() => {
						void refreshMutation.mutate();
					}}
				/>
			</div>

			<div className="lg:col-span-2 space-y-3">
				<QueueStatusStrip queues={queues} />
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<StatusDot variant="default" size="sm" pulse />
						<span className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
							INGESTION_JOBS
						</span>
						<span className="font-mono text-meta tabular-nums text-outline">
							{jobs.length} JOBS
						</span>
					</div>
					<Button
						variant="default"
						size="sm"
						onClick={() => setDialogOpen(true)}
					>
						NEW_INGEST
					</Button>
				</div>

				<div className="relative bracket-top-left bracket-bottom-right">
					<div className="border grid gap-2 p-2 border-outline-variant/30">
						{isLoading ? (
							<div className="py-8 text-center">
								<StatusDot variant="muted" size="md" pulse />
								<span className="font-mono text-body text-outline ml-2">
									LOADING…
								</span>
							</div>
						) : jobs.length === 0 ? (
							<div className="py-8 text-center space-y-2">
								<p className="font-mono text-body text-outline">
									NO_INGESTION_JOBS_YET
								</p>
								<p className="font-mono text-meta text-outline">
									PASTE_A_DIRECTORY_PATH_OR_S3_LINK_TO_BEGIN
								</p>
							</div>
						) : (
							jobs.map((job) => <JobRow key={job.id} job={job} />)
						)}
					</div>
				</div>
			</div>

			<NewIngestionDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onCreated={() => {
					void queryClient.invalidateQueries({
						queryKey: trpc.ingestion.list.queryKey(),
					});
				}}
			/>
		</div>
	);
}
