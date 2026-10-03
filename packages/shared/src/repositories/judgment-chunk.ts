import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { BaseRepository } from './base'
import { judgmentChunks, type JudgmentChunk, type NewJudgmentChunk } from '../schemas/judgments'
import { prepareEmbeddingForColumn } from '../embeddings'

export function hashJudgmentChunkText(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex')
}

export class JudgmentChunkRepository extends BaseRepository<JudgmentChunk, NewJudgmentChunk> {
	constructor() {
		super(judgmentChunks)
	}

	async findByJudgmentId(judgmentId: number): Promise<JudgmentChunk[]> {
		return this.db
			.select()
			.from(judgmentChunks)
			.where(eq(judgmentChunks.judgmentId, judgmentId))
	}

	async deleteByJudgmentId(judgmentId: number): Promise<void> {
		await this.db.delete(judgmentChunks).where(eq(judgmentChunks.judgmentId, judgmentId))
	}

	override async createMany(data: Omit<NewJudgmentChunk, 'id'>[]): Promise<JudgmentChunk[]> {
		const rows = data.map((row) => this.normalizeWrite(row))
		return super.createMany(rows)
	}

	/**
	 * Convergent insert for concurrent workers processing identical content
	 * (same checksum → same chunks): conflicting rows are already correct,
	 * so ignore them instead of failing with duplicate-key errors.
	 */
	async insertIgnoreConflicts(data: Omit<NewJudgmentChunk, 'id'>[]): Promise<void> {
		const rows = data.map((row) => this.normalizeWrite(row))
		if (rows.length === 0) return
		await this.db
			.insert(judgmentChunks)
			.values(rows)
			.onConflictDoNothing({ target: [judgmentChunks.judgmentId, judgmentChunks.chunkIndex] })
	}

	private normalizeWrite(row: Omit<NewJudgmentChunk, 'id'>): Omit<NewJudgmentChunk, 'id'> {
		const text = typeof row.text === 'string' ? row.text : ''
		const next: Omit<NewJudgmentChunk, 'id'> = {
			...row,
			textHash: row.textHash || (text ? hashJudgmentChunkText(text) : row.textHash),
		}
		if (Array.isArray(row.embedding) && row.embedding.length > 0 && row.embeddingModel && row.embeddingModel !== 'none') {
			const prepared = prepareEmbeddingForColumn(
				row.embedding,
				row.embeddingModel,
				row.embeddingDimensions ?? undefined,
			)
			next.embedding = prepared.columnVector
			next.embeddingDimensions = prepared.nativeDimensions
		}
		return next
	}
}
