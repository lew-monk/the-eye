import { documentRepository, coreferenceRepository } from '@workspace/shared'
import { jsonObjectContent } from '../../../lib/json'
import type { CoreferenceStoreBody } from './model'

export abstract class CoreferenceService {
	static async getExtractedText(documentId: number) {
		const document = await documentRepository.findById(documentId)
		if (!document) return null

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

		const fullContent = document.fullContent
		const text =
			typeof fullContent === 'object' && fullContent !== null
				? jsonObjectContent(fullContent)
				: ''

		const structured = document.structuredData as {
			pages?: { headings?: { text?: string }[] }[]
		} | null
		const sectionHeadings = Array.isArray(structured?.pages)
			? structured.pages.flatMap((p) =>
					Array.isArray(p?.headings)
						? p.headings
								.map((h) => (typeof h?.text === 'string' ? h.text : ''))
								.filter(Boolean)
						: [],
				)
			: []

		return {
			documentId: document.id,
			text,
			documentType: document.documentType,
			textHash: document.textHash || null,
			fileHash: document.fileHash || null,
			coreferenceSourceTextHash: stored?.sourceTextHash ?? null,
			existingCoref,
			status: document.status,
			sectionHeadings,
		}
	}

	static async storeCoreference(documentId: number, body: CoreferenceStoreBody) {
		const document = await documentRepository.findById(documentId)
		if (!document) return null

		if (document.textHash && document.textHash !== body.source_text_hash) {
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
