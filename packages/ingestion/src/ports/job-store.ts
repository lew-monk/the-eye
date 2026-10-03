import type { FileStatus, IngestionJob } from '../jobs/types'

export interface JobFileRecord {
	id: string
	jobId: string
	/** Document collection. Defaults to 'judgments'. */
	collection: string
	source: string
	sourceKey: string
	relativePath: string
	filename: string
	sizeBytes: number
	checksum: string
	storageKey: string | null
	status: FileStatus
	attempts: number
	lastError: string | null
	bytesTransferred: number
}

export interface JobStore {
	createJob(job: IngestionJob): Promise<void>
	getJob(jobId: string): Promise<IngestionJob | null>
	listJobs(): Promise<IngestionJob[]>
	updateJob(jobId: string, patch: Partial<IngestionJob>): Promise<void>
	upsertFile(file: JobFileRecord): Promise<void>
	getFile(jobId: string, checksum: string): Promise<JobFileRecord | null>
	listFiles(jobId: string): Promise<JobFileRecord[]>
	updateFile(jobId: string, checksum: string, patch: Partial<JobFileRecord>): Promise<void>
}
