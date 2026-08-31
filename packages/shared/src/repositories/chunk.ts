import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { BaseRepository } from './base'
import { documentChunks, type DocumentChunk, type NewDocumentChunk } from '../schemas'
import {
	EMBEDDING_COLUMN_DIMENSIONS,
	pgvectorLiteral,
	prepareEmbeddingForColumn,
} from '../embeddings'

export function hashChunkText(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex')
}

export interface ChunkCosineRow {
	documentId: number
	chunkIndex: number
	positionWeight: number
	cosineSimilarity: number
}

export class DocumentChunkRepository extends BaseRepository<DocumentChunk, NewDocumentChunk> {
	constructor() {
		super(documentChunks)
	}

	async findByDocumentId(documentId: number): Promise<DocumentChunk[]> {
		return this.db
			.select()
			.from(documentChunks)
			.where(eq(documentChunks.documentId, documentId))
	}

	async deleteByDocumentId(documentId: number): Promise<void> {
		await this.db
			.delete(documentChunks)
			.where(eq(documentChunks.documentId, documentId))
	}

	override async createMany(data: Omit<NewDocumentChunk, 'id'>[]): Promise<DocumentChunk[]> {
		const rows = data.map((row) => this.normalizeWrite(row))
		return super.createMany(rows)
	}

	async updateEmbedding(
		id: number,
		embedding: number[],
		meta?: { model: string; nativeDimensions?: number; textHash?: string },
	): Promise<void> {
		const model = meta?.model
		const prepared = model
			? prepareEmbeddingForColumn(embedding, model, meta?.nativeDimensions)
			: { columnVector: asColumnVector(embedding), nativeDimensions: trailingNonZeroLength(embedding) }

		await this.db
			.update(documentChunks)
			.set({
				embedding: prepared.columnVector,
				embeddingDimensions: prepared.nativeDimensions,
				...(model ? { embeddingModel: model } : {}),
				...(meta?.textHash ? { chunkTextHash: meta.textHash } : {}),
				updatedAt: new Date(),
			} as any)
			.where(eq(documentChunks.id, id))
	}

	async findSimilarChunks(
		embedding: number[],
		excludeDocumentId: number,
		limit = 50,
		opts?: { embeddingModel: string; nativeDimensions?: number; currentOnly?: boolean },
	): Promise<ChunkCosineRow[]> {
		if (!opts?.embeddingModel) {
			throw new Error('findSimilarChunks requires embeddingModel so mixed-model rows are not compared')
		}

		const columnVector = queryColumnVector(embedding, opts.embeddingModel, opts.nativeDimensions)
		const vectorStr = pgvectorLiteral(columnVector)
		const currentOnly = opts.currentOnly !== false

		const result = await this.db.execute(
			sql`
				SELECT
					dc.document_id AS "documentId",
					dc.chunk_index AS "chunkIndex",
					COALESCE(dc.position_weight, 1.0) AS "positionWeight",
					1 - (dc.embedding <=> ${vectorStr}::vector) AS "cosineSimilarity"
				FROM document_chunks dc
				INNER JOIN documents d ON d.id = dc.document_id
				WHERE dc.document_id != ${excludeDocumentId}
					AND dc.embedding IS NOT NULL
					AND dc.embedding_model = ${opts.embeddingModel}
					${currentOnly ? sql`AND COALESCE(d.is_current, true) = true` : sql``}
				ORDER BY dc.embedding <=> ${vectorStr}::vector
				LIMIT ${limit}
			`,
		)
		return result as unknown as ChunkCosineRow[]
	}

	private normalizeWrite(row: Omit<NewDocumentChunk, 'id'>): Omit<NewDocumentChunk, 'id'> {
		const text = typeof row.text === 'string' ? row.text : ''
		const next: Omit<NewDocumentChunk, 'id'> = {
			...row,
			chunkTextHash: row.chunkTextHash || (text ? hashChunkText(text) : row.chunkTextHash),
		}
		if (Array.isArray(row.embedding) && row.embedding.length > 0 && row.embeddingModel && row.embeddingModel !== 'none') {
			const prepared = prepareEmbeddingForColumn(
				row.embedding,
				row.embeddingModel,
				row.embeddingDimensions ?? undefined,
			)
			next.embedding = prepared.columnVector as any
			next.embeddingDimensions = prepared.nativeDimensions
		}
		return next
	}
}

function asColumnVector(values: number[]): number[] {
	if (values.length === EMBEDDING_COLUMN_DIMENSIONS) return values
	if (values.length > EMBEDDING_COLUMN_DIMENSIONS) {
		throw new Error(`Embedding length ${values.length} exceeds column ${EMBEDDING_COLUMN_DIMENSIONS}`)
	}
	return [...values, ...new Array(EMBEDDING_COLUMN_DIMENSIONS - values.length).fill(0)]
}

function queryColumnVector(values: number[], model: string, nativeDim?: number): number[] {
	if (values.length === EMBEDDING_COLUMN_DIMENSIONS) return values
	return prepareEmbeddingForColumn(values, model, nativeDim).columnVector
}

function trailingNonZeroLength(values: number[]): number {
	let end = values.length
	while (end > 0 && values[end - 1] === 0) end--
	return end
}
