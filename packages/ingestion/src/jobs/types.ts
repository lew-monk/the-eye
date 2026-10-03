export type FileStatus =
	| 'discovered'
	| 'staged'
	| 'uploaded'
	| 'ocr'
	| 'embedded'
	| 'summarized'
	| 'failed'

export type JobStatus = 'pending' | 'discovering' | 'transferring' | 'processing' | 'done' | 'failed' | 'partial'

export const DEFAULT_COLLECTION = 'judgments'

export function normalizeCollection(input: string | null | undefined): string {
	const collection = (input ?? '').trim() || DEFAULT_COLLECTION
	if (!/^[a-z0-9-]{1,64}$/i.test(collection)) {
		throw new Error(`Invalid collection: ${input}`)
	}
	return collection.toLowerCase()
}

export interface IngestionJob {
	id: string
	source: string
	root: string
	/** Document collection this job ingests into. Defaults to 'judgments'. */
	collection: string
	status: JobStatus
	totalFiles: number
	doneFiles: number
	failedFiles: number
	totalBytes: number
	transferredBytes: number
	createdAt: string
	updatedAt: string
	lastError: string | null
}

export type JobEventKind =
	| 'job-started'
	| 'file-discovered'
	| 'file-progress'
	| 'file-done'
	| 'file-failed'
	| 'files-queued'
	| 'job-done'
	| 'job-failed'

export interface JobEvent {
	jobId: string
	kind: JobEventKind
	seq: number
	at: string
	relativePath?: string
	checksum?: string
	transferredBytes?: number
	sizeBytes?: number
	error?: string
	/** Processing stage for worker-derived events (ocr, embedded, processed…). Upload-phase events omit it. */
	stage?: string
	/** Worker progress 0–100 for file-progress events. */
	pct?: number
}

const FILE_TRANSITIONS: Record<FileStatus, readonly FileStatus[]> = {
	discovered: ['staged', 'failed'],
	staged: ['uploaded', 'failed'],
	uploaded: ['ocr', 'failed'],
	ocr: ['embedded', 'failed'],
	embedded: ['summarized', 'failed'],
	summarized: [],
	failed: ['staged'],
}

export function canTransitionFile(from: FileStatus, to: FileStatus): boolean {
	return FILE_TRANSITIONS[from]?.includes(to) ?? false
}

export function assertFileTransition(from: FileStatus, to: FileStatus): void {
	if (!canTransitionFile(from, to)) {
		throw new Error(`Illegal file transition ${from} -> ${to}`)
	}
}

const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
	pending: ['discovering'],
	discovering: ['transferring', 'failed'],
	transferring: ['processing', 'partial', 'failed'],
	processing: ['done', 'partial', 'failed'],
	done: [],
	partial: [],
	failed: [],
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
	return JOB_TRANSITIONS[from]?.includes(to) ?? false
}
