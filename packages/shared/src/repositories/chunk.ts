import { eq } from 'drizzle-orm'
import { BaseRepository } from './base'
import { documentChunks, EMBEDDING_COLUMN_DIMENSIONS, type DocumentChunk, type NewDocumentChunk } from '../schemas'

function padToLength(values: number[], targetLength: number): number[] {
	if (values.length === targetLength) return values
	if (values.length > targetLength) return values.slice(0, targetLength)
	return [...values, ...new Array(targetLength - values.length).fill(0)]
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

	async updateEmbedding(id: number, embedding: number[]): Promise<void> {
		await this.db
			.update(documentChunks)
			.set({ embedding: padToLength(embedding, EMBEDDING_COLUMN_DIMENSIONS) } as any)
			.where(eq(documentChunks.id, id))
	}
}
