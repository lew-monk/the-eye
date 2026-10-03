import type { JobFileRecord } from '../ports/job-store'
import type { IngestionJob } from './types'

/** In-memory JobStore — default for tests and local API dev. */
export class InMemoryJobStore {
	private jobs = new Map<string, IngestionJob>()
	private files = new Map<string, Map<string, JobFileRecord>>()

	async createJob(job: IngestionJob): Promise<void> {
		if (this.jobs.has(job.id)) throw new Error(`Job exists: ${job.id}`)
		this.jobs.set(job.id, { ...job })
		this.files.set(job.id, new Map())
	}

	async getJob(jobId: string): Promise<IngestionJob | null> {
		return this.jobs.get(jobId) ?? null
	}

	async listJobs(): Promise<IngestionJob[]> {
		return [...this.jobs.values()]
	}

	async updateJob(jobId: string, patch: Partial<IngestionJob>): Promise<void> {
		const job = this.jobs.get(jobId)
		if (!job) throw new Error(`Job not found: ${jobId}`)
		this.jobs.set(jobId, { ...job, ...patch, updatedAt: new Date().toISOString() })
	}

	async upsertFile(file: JobFileRecord): Promise<void> {
		const bucket = this.files.get(file.jobId) ?? new Map<string, JobFileRecord>()
		bucket.set(file.checksum, { ...file })
		this.files.set(file.jobId, bucket)
	}

	async getFile(jobId: string, checksum: string): Promise<JobFileRecord | null> {
		return this.files.get(jobId)?.get(checksum) ?? null
	}

	async listFiles(jobId: string): Promise<JobFileRecord[]> {
		return [...(this.files.get(jobId)?.values() ?? [])]
	}

	async updateFile(jobId: string, checksum: string, patch: Partial<JobFileRecord>): Promise<void> {
		const bucket = this.files.get(jobId)
		const file = bucket?.get(checksum)
		if (!bucket || !file) throw new Error(`File not found: ${jobId}/${checksum}`)
		bucket.set(checksum, { ...file, ...patch })
	}
}
