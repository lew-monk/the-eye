import { DocumentQueue } from '@workspace/core'
import { documentRepository, chunkRepository, participantRepository, coreferenceRepository } from '@workspace/shared'

export abstract class DocumentsService {
	static async reprocess(documentId: number): Promise<{ success: boolean; documentId: number } | null> {
		const document = await documentRepository.findById(documentId)
		if (!document) return null

		await Promise.all([
			chunkRepository.deleteByDocumentId(documentId),
			participantRepository.deleteByDocumentId(documentId),
			coreferenceRepository.deleteByDocumentId(documentId),
		])

		await documentRepository.updateById(documentId, {
			status: 'pending',
			errorMessage: null,
			normalizedText: null,
			embeddingVersion: null,
			embeddingProvider: null,
			embeddingModel: null,
			extractionVersion: 1,
		})

		await documentRepository.addProcessingLog({
			documentId,
			action: 'reprocess_queued',
			details: { previousStatus: document.status },
		})

		const textHash = (document as any).textHash
		if (textHash) {
			const queue = new DocumentQueue()
			await queue.addDocumentToCorefQueue(documentId, textHash)
		}

		return { success: true, documentId }
	}
}
