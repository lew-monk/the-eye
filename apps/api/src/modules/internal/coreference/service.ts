import { documentRepository, coreferenceRepository } from '@workspace/shared'

export abstract class CoreferenceService {
	static async getExtractedText(documentId: number) {
		const document = await documentRepository.findById(documentId)
		if (!document) return null

		const content =
			document.fullContent && typeof document.fullContent === 'object'
				? (document.fullContent as any).content || ''
				: ''

		const corefSourceTextHash = await coreferenceRepository.getSourceTextHash(documentId)

		return {
			documentId: document.id,
			text: content,
			textHash: (document as any).textHash || null,
			fileHash: (document as any).fileHash || null,
			coreferenceSourceTextHash: corefSourceTextHash,
			status: document.status,
		}
	}

	static async storeCoreference(documentId: number, body: any) {
		const document = await documentRepository.findById(documentId)
		if (!document) return null

		if ((document as any).textHash && (document as any).textHash !== body.source_text_hash) {
			return { hashMismatch: true }
		}

		await coreferenceRepository.store(documentId, {
			resolvedText: body.resolved_text,
			model: body.model,
			modelVersion: body.model_version,
			sourceTextHash: body.source_text_hash,
			processedAt: body.processed_at,
			processingTimeMs: body.processing_time_ms,
			inputCharCount: body.input_char_count,
			chunked: body.chunked,
			chunkSize: body.chunk_size,
			chunkCount: body.chunk_count,
			clusters: body.clusters,
			mentions: body.mentions,
		})

		await documentRepository.addProcessingLog({
			documentId,
			action: 'coreference_completed',
			details: {
				model: body?.model,
				modelVersion: body?.model_version,
				inputCharCount: body?.input_char_count,
				processingTimeMs: body?.processing_time_ms,
			},
		})

		return { success: true }
	}
}
