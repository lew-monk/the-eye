import { eq } from 'drizzle-orm'
import { BaseRepository } from './base'
import { ingestionJobs, type IngestionJobRow, type NewIngestionJobRow } from '../schemas/ingestion'

export class IngestionJobRepository extends BaseRepository<IngestionJobRow, NewIngestionJobRow> {
	constructor() {
		super(ingestionJobs)
	}

	/** Text PK (uuid) — base create() omits id, so insert explicitly. */
	async createJob(row: NewIngestionJobRow): Promise<IngestionJobRow> {
		const result = await this.db.insert(ingestionJobs).values(row).returning()
		const created = result[0]
		if (!created) throw new Error('Failed to create ingestion job')
		return created as IngestionJobRow
	}

	async updateJob(id: string, patch: Partial<IngestionJobRow>): Promise<IngestionJobRow | null> {
		const result = await this.db
			.update(ingestionJobs)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(ingestionJobs.id, id))
			.returning()
		const row = result[0]
		return (row as IngestionJobRow) ?? null
	}

	async findByStatus(status: string): Promise<IngestionJobRow[]> {
		const result = await this.findMany([eq(ingestionJobs.status, status)], { limit: 1000 })
		return result.data
	}

	async findByCollection(collection: string): Promise<IngestionJobRow[]> {
		const result = await this.findMany([eq(ingestionJobs.collection, collection)], { limit: 1000 })
		return result.data
	}
}
