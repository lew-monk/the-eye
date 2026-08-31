import { documentRepository, coreferenceRepository } from '@workspace/shared'

export abstract class CoreferenceService {
	static async getExtractedText(documentId: number) {
		const document = await documentRepository.findById(documentId)
		if (!document) return null

		const content =
			document.fullContent && typeof document.fullContent === 'object'
				? (document.fullContent as any).content || ''
				: ''

		const stored = await coreferenceRepository.findByDocumentId(documentId)
		const existingCoref = stored
			? {
					resolvedText: stored.resolvedText,
					clusters: stored.clusters.map((c) => c.mentions.map((m) => m.text)),
					mentions: stored.clusters.flatMap((c) =>
						c.mentions.map((m) => ({
							text: m.text,
							start: m.startPos,
							end: m.endPos,
							cluster_id: c.clusterIndex,
						})),
					),
				}
			: null

		return {
			documentId: document.id,
			text: content,
			documentType: document.documentType,
			textHash: (document as any).textHash || null,
			fileHash: (document as any).fileHash || null,
			coreferenceSourceTextHash: stored?.sourceTextHash ?? null,
			existingCoref,
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
			action: 'coref_completed',
			details: {
				model: body?.model,
				modelVersion: body?.model_version,
				inputCharCount: body?.input_char_count,
				processingTimeMs: body?.processing_time_ms,
				chunked: body?.chunked,
				chunkCount: body?.chunk_count,
				clusters: Array.isArray(body?.clusters) ? body.clusters.length : undefined,
				mentions: Array.isArray(body?.mentions) ? body.mentions.length : undefined,
			},
		})

		console.log(`[DOC ${documentId}] coref_completed`, {
			model: body?.model,
			inputCharCount: body?.input_char_count,
			processingTimeMs: body?.processing_time_ms,
			chunkCount: body?.chunk_count,
		})

		return { success: true }
	}
}
