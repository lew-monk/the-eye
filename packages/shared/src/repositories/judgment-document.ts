import { eq } from 'drizzle-orm'
import { BaseRepository } from './base'
import { judgmentDocuments, type JudgmentDocument, type NewJudgmentDocument } from '../schemas/judgments'

export class JudgmentDocumentRepository extends BaseRepository<JudgmentDocument, NewJudgmentDocument> {
	constructor() {
		super(judgmentDocuments)
	}

	async findByChecksum(checksum: string): Promise<JudgmentDocument | null> {
		const [row] = await this.db
			.select()
			.from(judgmentDocuments)
			.where(eq(judgmentDocuments.checksum, checksum))
			.limit(1)
		return (row as JudgmentDocument) ?? null
	}

	async findByJobId(jobId: string): Promise<JudgmentDocument[]> {
		const result = await this.findMany([eq(judgmentDocuments.jobId, jobId)], { limit: 1000 })
		return result.data
	}

	async findByCollection(collection: string): Promise<JudgmentDocument[]> {
		const result = await this.findMany([eq(judgmentDocuments.collection, collection)], { limit: 1000 })
		return result.data
	}

	async findByStatus(status: string): Promise<JudgmentDocument[]> {
		const result = await this.findMany([eq(judgmentDocuments.status, status)], { limit: 1000 })
		return result.data
	}

	async upsertByChecksum(row: Omit<NewJudgmentDocument, 'id'>): Promise<JudgmentDocument> {
		// Atomic: concurrent workers ingesting identical content (same file in
		// two folders, redeliveries) must not hit duplicate-key errors.
		// First writer wins the identity columns; losers read back the row.
		const [inserted] = await this.db
			.insert(judgmentDocuments)
			.values(row)
			.onConflictDoNothing({ target: judgmentDocuments.checksum })
			.returning()
		if (inserted) return inserted as JudgmentDocument
		const existing = await this.findByChecksum(row.checksum as string)
		if (!existing) {
			throw new Error(`Checksum row vanished after upsert: ${row.checksum}`)
		}
		return existing
	}

	async updateByChecksum(checksum: string, patch: Partial<JudgmentDocument>): Promise<JudgmentDocument | null> {
		const existing = await this.findByChecksum(checksum)
		if (!existing) return null
		return this.updateById(existing.id, patch)
	}
}
