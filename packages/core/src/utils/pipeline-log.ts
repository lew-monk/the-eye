import { documentRepository } from '@workspace/shared'

/** Canonical document.status values (DB + UI). */
export const DocumentStatus = {
	QUEUED: 'queued',
	PROCESSING: 'processing',
	COMPLETED: 'completed',
	FAILED: 'failed',
} as const

export type DocumentStatusValue = (typeof DocumentStatus)[keyof typeof DocumentStatus]

/** Fine-grained pipeline stages (processing_logs.action + console). */
export const PipelineStage = {
	UPLOAD_RECEIVED: 'upload_received',
	DOCUMENT_CREATED: 'document_created',
	QUEUED: 'queued',
	WORKER_STARTED: 'worker_started',
	OCR_STARTED: 'ocr_started',
	OCR_INSPECTING: 'ocr_inspecting',
	OCR_SPLIT_STARTED: 'ocr_split_started',
	OCR_SPLIT_PROGRESS: 'ocr_split_progress',
	OCR_SPLIT_DONE: 'ocr_split_done',
	OCR_SINGLE: 'ocr_single',
	OCR_CHUNK_STARTED: 'ocr_chunk_started',
	OCR_AZURE_SUBMITTING: 'ocr_azure_submitting',
	OCR_AZURE_SUBMITTED: 'ocr_azure_submitted',
	OCR_AZURE_POLLING: 'ocr_azure_polling',
	OCR_CHUNK_COMPLETED: 'ocr_chunk_completed',
	OCR_REASSEMBLED: 'ocr_reassembled',
	OCR_COMPLETED: 'ocr_completed',
	RESULTS_PERSISTED: 'results_persisted',
	COREF_QUEUED: 'coref_queued',
	COREF_STARTED: 'coref_started',
	COREF_FETCHED: 'coref_fetched',
	COREF_CHUNKING: 'coref_chunking',
	COREF_INFERENCE_STARTED: 'coref_inference_started',
	COREF_INFERENCE_PROGRESS: 'coref_inference_progress',
	COREF_INFERENCE_DONE: 'coref_inference_done',
	COREF_POSTING: 'coref_posting',
	COREF_COMPLETED: 'coref_completed',
	COREF_PARTICIPANTS: 'coref_participants',
	COREF_CHUNKS: 'coref_chunks',
	COREF_SKIPPED: 'coref_skipped',
	COREF_FAILED: 'coref_failed',
	FAILED: 'processing_failed',
} as const

export type PipelineStageValue = (typeof PipelineStage)[keyof typeof PipelineStage]

export function pipelineLog(
	documentId: number,
	stage: string,
	details?: Record<string, unknown>,
): void {
	const payload = details && Object.keys(details).length > 0 ? details : undefined
	if (payload) {
		console.log(`[DOC ${documentId}] ${stage}`, payload)
	} else {
		console.log(`[DOC ${documentId}] ${stage}`)
	}
}

export async function logPipelineStage(
	documentId: number,
	stage: string,
	details?: Record<string, unknown>,
): Promise<void> {
	pipelineLog(documentId, stage, details)
	try {
		const exists = await documentRepository.findById(documentId)
		if (!exists) {
			console.warn(
				`[DOC ${documentId}] skip processing_logs insert for ${stage}: document row missing (stale job or deleted)`,
			)
			return
		}
		await documentRepository.addProcessingLog({
			documentId,
			action: stage,
			details: details ?? {},
		})
	} catch (error) {
		// FK / DB errors must never abort OCR — console already has the stage
		const message = error instanceof Error ? error.message : String(error)
		console.warn(`[DOC ${documentId}] failed to persist processing log for ${stage}: ${message}`)
	}
}
