import { eq, and } from 'drizzle-orm'
import type { JobStore, JobFileRecord } from '../ports/job-store'
import type { FileStatus, IngestionJob, JobStatus } from '../jobs/types'

export interface DrizzleLike {
	insert: unknown
	select: unknown
	update: unknown
}

export interface DrizzleJobDeps {
	findById(id: string): Promise<Record<string, unknown> | null>
	list(): Promise<Record<string, unknown>[]>
	create(row: Record<string, unknown>): Promise<Record<string, unknown>>
	update(id: string, patch: Record<string, unknown>): Promise<void>
}

export interface DrizzleFileDeps {
	findByChecksum(checksum: string): Promise<Record<string, unknown> | null>
	create(row: Record<string, unknown>): Promise<Record<string, unknown>>
	update(checksum: string, patch: Record<string, unknown>): Promise<void>
	listByJob(jobId: string): Promise<Record<string, unknown>[]>
	/**
	 * Atomic insert-or-get (first writer wins identity). Preferred over the
	 * find-then-create fallback: concurrent workers ingesting identical
	 * content would otherwise race into duplicate-key errors.
	 */
	upsert?(row: Record<string, unknown>): Promise<Record<string, unknown>>
}

/**
 * Durable JobStore: job aggregates in `ingestion_jobs`, file rows in
 * `judgment_documents`. Deps are injected (repositories in prod, fakes in
 * tests) so this file stays free of direct drizzle imports.
 */
export class DrizzleJobStore implements JobStore {
	constructor(private readonly deps: { jobs: DrizzleJobDeps; files: DrizzleFileDeps }) {}

	async createJob(job: IngestionJob): Promise<void> {
		await this.deps.jobs.create(toJobRow(job))
	}

	async getJob(jobId: string): Promise<IngestionJob | null> {
		const row = await this.deps.jobs.findById(jobId)
		return row ? jobFromRow(row) : null
	}

	async listJobs(): Promise<IngestionJob[]> {
		const rows = await this.deps.jobs.list()
		return rows.map(jobFromRow)
	}

	async updateJob(jobId: string, patch: Partial<IngestionJob>): Promise<void> {
		await this.deps.jobs.update(jobId, toJobRowPatch(patch))
	}

	async upsertFile(file: JobFileRecord): Promise<void> {
		if (this.deps.files.upsert) {
			await this.deps.files.upsert(toRow(file))
			return
		}
		const existing = await this.deps.files.findByChecksum(file.checksum)
		if (existing) {
			await this.deps.files.update(file.checksum, toRow(file))
			return
		}
		await this.deps.files.create(toRow(file))
	}

	async getFile(_jobId: string, checksum: string): Promise<JobFileRecord | null> {
		const row = await this.deps.files.findByChecksum(checksum)
		return row ? fromRow(row) : null
	}

	async listFiles(jobId: string): Promise<JobFileRecord[]> {
		const rows = await this.deps.files.listByJob(jobId)
		return rows.map(fromRow)
	}

	async updateFile(_jobId: string, checksum: string, patch: Partial<JobFileRecord>): Promise<void> {
		await this.deps.files.update(checksum, toRowPatch(patch))
	}
}

function toDate(value: unknown): Date {
	if (value instanceof Date) return value
	if (typeof value === 'string' || typeof value === 'number') return new Date(value)
	return new Date()
}

function toIso(value: unknown): string {
	if (typeof value === 'string') return value
	return toDate(value).toISOString()
}

function toJobRow(job: IngestionJob): Record<string, unknown> {
	return {
		id: job.id,
		collection: job.collection,
		source: job.source,
		root: job.root,
		status: job.status,
		totalFiles: job.totalFiles,
		doneFiles: job.doneFiles,
		failedFiles: job.failedFiles,
		totalBytes: job.totalBytes,
		transferredBytes: job.transferredBytes,
		lastError: job.lastError,
		createdAt: toDate(job.createdAt),
		updatedAt: toDate(job.updatedAt),
	}
}

function toJobRowPatch(patch: Partial<IngestionJob>): Record<string, unknown> {
	const out: Record<string, unknown> = { updatedAt: new Date() }
	if (patch.collection !== undefined) out.collection = patch.collection
	if (patch.source !== undefined) out.source = patch.source
	if (patch.root !== undefined) out.root = patch.root
	if (patch.status !== undefined) out.status = patch.status
	if (patch.totalFiles !== undefined) out.totalFiles = patch.totalFiles
	if (patch.doneFiles !== undefined) out.doneFiles = patch.doneFiles
	if (patch.failedFiles !== undefined) out.failedFiles = patch.failedFiles
	if (patch.totalBytes !== undefined) out.totalBytes = patch.totalBytes
	if (patch.transferredBytes !== undefined) out.transferredBytes = patch.transferredBytes
	if (patch.lastError !== undefined) out.lastError = patch.lastError
	return out
}

function jobFromRow(row: Record<string, unknown>): IngestionJob {
	return {
		id: String(row.id ?? ''),
		collection: String(row.collection ?? 'judgments'),
		source: String(row.source ?? ''),
		root: String(row.root ?? ''),
		status: (row.status as JobStatus) ?? 'pending',
		totalFiles: Number(row.totalFiles ?? 0),
		doneFiles: Number(row.doneFiles ?? 0),
		failedFiles: Number(row.failedFiles ?? 0),
		totalBytes: Number(row.totalBytes ?? 0),
		transferredBytes: Number(row.transferredBytes ?? 0),
		createdAt: toIso(row.createdAt ?? new Date(0)),
		updatedAt: toIso(row.updatedAt ?? new Date(0)),
		lastError: (row.lastError as string | null) ?? null,
	}
}

function toRow(file: JobFileRecord): Record<string, unknown> {
	return {
		collection: file.collection,
		source: file.source,
		sourceKey: file.sourceKey,
		relativePath: file.relativePath,
		filename: file.filename,
		sizeBytes: file.sizeBytes,
		checksum: file.checksum,
		storageKey: file.storageKey,
		status: file.status,
		attempts: file.attempts,
		lastError: file.lastError,
		bytesTransferred: file.bytesTransferred,
		jobId: file.jobId,
	}
}

function toRowPatch(patch: Partial<JobFileRecord>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	if (patch.storageKey !== undefined) out.storageKey = patch.storageKey
	if (patch.status !== undefined) out.status = patch.status
	if (patch.attempts !== undefined) out.attempts = patch.attempts
	if (patch.lastError !== undefined) out.lastError = patch.lastError
	if (patch.bytesTransferred !== undefined) out.bytesTransferred = patch.bytesTransferred
	return out
}

function fromRow(row: Record<string, unknown>): JobFileRecord {
	return {
		id: String(row.id ?? `${row.jobId}:${row.checksum}`),
		jobId: String(row.jobId ?? ''),
		collection: String(row.collection ?? 'judgments'),
		source: String(row.source ?? ''),
		sourceKey: String(row.sourceKey ?? ''),
		relativePath: String(row.relativePath ?? ''),
		filename: String(row.filename ?? ''),
		sizeBytes: Number(row.sizeBytes ?? 0),
		checksum: String(row.checksum ?? ''),
		storageKey: (row.storageKey as string | null) ?? null,
		status: (row.status as FileStatus) ?? 'discovered',
		attempts: Number(row.attempts ?? 0),
		lastError: (row.lastError as string | null) ?? null,
		bytesTransferred: Number(row.bytesTransferred ?? 0),
	}
}

export type { IngestionJob }
export { eq, and }
