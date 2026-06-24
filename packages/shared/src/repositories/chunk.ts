import { eq } from 'drizzle-orm'
import { BaseRepository } from './base'
import { documentChunks, type DocumentChunk, type NewDocumentChunk } from '../schemas'

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
}
