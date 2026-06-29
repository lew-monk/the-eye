import { DocumentQueue } from '@workspace/core'
import { documentRepository, chunkRepository } from '@workspace/shared'

export abstract class ChunksService {
	static async store(
		documentId: number,
		chunks: any[],
		embeddingVersion: number,
		embeddingProvider: string,
		embeddingModel: string,
		normalizedText?: string,
	) {
		const document = await documentRepository.findById(documentId)
		const queue = new DocumentQueue()
		if (!document) return null

		const rows = chunks.map((c) => ({
			...c,
			documentId,
			embeddingProvider,
			embeddingModel,
		}))

		await chunkRepository.deleteByDocumentId(documentId)
		const inserted = await chunkRepository.createMany(rows)

		const documentUpdates: Record<string, any> = {
			embeddingVersion,
			embeddingProvider,
			embeddingModel,
		}
		if (normalizedText !== undefined) {
			documentUpdates.normalizedText = normalizedText
		}
		await documentRepository.updateById(documentId, documentUpdates as any)

		await documentRepository.addProcessingLog({
			documentId,
			action: 'chunks_embedded',
			details: {
				count: inserted.length,
				version: embeddingVersion,
				provider: embeddingProvider,
				model: embeddingModel,
				normalized: normalizedText !== undefined,
			},
		})

		await queue.addDocumentChunkToQueue(documentId)

		return { count: inserted.length }
	}
}
