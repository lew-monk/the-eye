import { documentRepository } from '@workspace/shared'
import { createHash } from 'crypto'
import { validateDocumentUpload, DocumentType } from '@workspace/shared'
import { getAzureOCRService, type OCRResult } from './ocr'
import { getDocumentQueue, DocumentQueue, QueueProcessingOptions } from './services/queue'
import type { Document } from '@workspace/shared'
import { DocumentStatus, PipelineStage, logPipelineStage, pipelineLog } from './utils/pipeline-log'

export interface OCRServiceConfig {
	useQueue?: boolean
}

export class OCRService {
	private useQueue: boolean
	private azureService = getAzureOCRService()
	private queue?: DocumentQueue

	constructor(config: OCRServiceConfig = {}) {
		this.useQueue = config.useQueue ?? false
		if (this.useQueue) {
			// Singleton — never spawn a new BullMQ Worker per upload
			this.queue = getDocumentQueue()
		}
	}

	async processDocument(
		fileBuffer: Buffer,
		metadata: {
			filename: string
			fileType: string
			fileSize: number
			documentType: DocumentType
		},
		options: {
			extractFullContent?: boolean
			customModelId?: string
		} = {},
		caseId?: number,
	): Promise<{ documentId: number; result?: OCRResult }> {
		const validatedMetadata = validateDocumentUpload(metadata)
		const fileHash = createHash('sha256').update(fileBuffer).digest('hex')

		const existing = await (documentRepository as any).findByFileHash(fileHash)
		if (existing && existing.status !== DocumentStatus.FAILED) {
			pipelineLog(existing.id, 'dedup_hit', {
				filename: validatedMetadata.filename,
				status: existing.status,
				fileHash,
			})
			return { documentId: existing.id }
		}

		const document = await (documentRepository as any).create({
			filename: validatedMetadata.filename,
			fileType: validatedMetadata.fileType,
			fileSize: validatedMetadata.fileSize,
			documentType: validatedMetadata.documentType,
			caseId: caseId ?? null,
			fileHash,
			status: this.useQueue ? DocumentStatus.QUEUED : DocumentStatus.PROCESSING,
		})

		await logPipelineStage(document.id, PipelineStage.DOCUMENT_CREATED, {
			filename: validatedMetadata.filename,
			fileType: validatedMetadata.fileType,
			fileSize: validatedMetadata.fileSize,
			documentType: validatedMetadata.documentType,
			caseId: caseId ?? null,
			fileHash,
			mode: this.useQueue ? 'queue' : 'sync',
			status: this.useQueue ? DocumentStatus.QUEUED : DocumentStatus.PROCESSING,
		})

		const queueOptions: QueueProcessingOptions = {
			documentType: validatedMetadata.documentType,
			extractFullContent: options.extractFullContent ?? true,
			...(options.customModelId && { customModelId: options.customModelId }),
		}

		if (this.useQueue && this.queue) {
			await this.queue.addDocument(document.id, fileBuffer, queueOptions)
			return { documentId: document.id }
		}

		try {
			const result = await this.azureService.processDocumentFromBuffer(document.id, fileBuffer)

			await documentRepository.updateById(document.id, {
				status: DocumentStatus.COMPLETED,
				processedAt: new Date(),
				structuredData: result.structuredData,
				fullContent: { content: result.content },
				confidence: result.confidence,
			})

			await logPipelineStage(document.id, PipelineStage.RESULTS_PERSISTED, {
				mode: 'sync',
				confidence: result.confidence,
				contentLength: result.content?.length ?? 0,
			})

			return { documentId: document.id, result }
		} catch (error: any) {
			await documentRepository.updateById(document.id, {
				status: DocumentStatus.FAILED,
				errorMessage: error.message,
			})
			throw error
		}
	}

	async getDocument(documentId: number): Promise<Document | null> {
		return documentRepository.findById(documentId)
	}

	async getDocumentByCaseNumber(caseNumber: string): Promise<Document[]> {
		return documentRepository.findByCaseNumber(caseNumber)
	}

	async getDocumentsByType(documentType: DocumentType): Promise<Document[]> {
		return documentRepository.findByDocumentType(documentType)
	}

	async getPendingDocuments(): Promise<Document[]> {
		return documentRepository.findByStatus('pending')
	}

	async getProcessingDocuments(): Promise<Document[]> {
		return documentRepository.findByStatus(DocumentStatus.PROCESSING)
	}

	async getCompletedDocuments(): Promise<Document[]> {
		return documentRepository.findByStatus(DocumentStatus.COMPLETED)
	}

	async getFailedDocuments(): Promise<Document[]> {
		return documentRepository.findByStatus(DocumentStatus.FAILED)
	}

	async close(): Promise<void> {
		if (this.queue) {
			await this.queue.close()
		}
	}
}

// Singleton — prefer queue mode once requested (upload path)
let ocrServiceInstance: OCRService | null = null;

export function getOCRService(config?: OCRServiceConfig): OCRService {
	if (!ocrServiceInstance) {
		ocrServiceInstance = new OCRService(config);
	} else if (config?.useQueue && !ocrServiceInstance['useQueue']) {
		// Upgrade lazy instance if first call was sync-only
		ocrServiceInstance = new OCRService({ useQueue: true });
	}
	return ocrServiceInstance;
}
