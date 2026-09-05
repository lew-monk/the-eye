import { documentRepository, getMimeType } from '@workspace/shared'
import { createHash } from 'crypto'
import { validateDocumentUpload, DocumentType } from '@workspace/shared'
import { getAzureOCRService, type OCRResult } from './ocr'
import { getDocumentQueue, DocumentQueue, QueueProcessingOptions } from './services/queue'
import type { Document } from '@workspace/shared'
import { DocumentStatus, PipelineStage, logPipelineStage, pipelineLog } from './utils/pipeline-log'
import {
	buildDocumentStorageKey,
	getObjectStorage,
	isObjectStorageConfigured,
	type ObjectStorage,
} from './services/storage'

export interface OCRServiceConfig {
	useQueue?: boolean
	/** Inject storage for tests; defaults to getObjectStorage() when configured. */
	objectStorage?: ObjectStorage | null
}

export class OCRService {
	private useQueue: boolean
	private azureService = getAzureOCRService()
	private queue?: DocumentQueue
	private objectStorage: ObjectStorage | null

	constructor(config: OCRServiceConfig = {}) {
		this.useQueue = config.useQueue ?? false
		if (this.useQueue) {
			// Singleton — never spawn a new BullMQ Worker per upload
			this.queue = getDocumentQueue()
		}
		if (config.objectStorage !== undefined) {
			this.objectStorage = config.objectStorage
		} else {
			this.objectStorage = isObjectStorageConfigured() ? getObjectStorage() : null
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

			// Backfill storage for legacy rows that never persisted the original
			if (this.objectStorage && !existing.storageKey) {
				await this.persistOriginal(existing.id, fileBuffer, {
					filename: validatedMetadata.filename,
					fileHash,
					caseId: existing.caseId ?? caseId ?? null,
				})
			}

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

		if (this.objectStorage) {
			try {
				await this.persistOriginal(document.id, fileBuffer, {
					filename: validatedMetadata.filename,
					fileHash,
					caseId: caseId ?? null,
				})
			} catch (error: any) {
				const message = error instanceof Error ? error.message : String(error)
				await logPipelineStage(document.id, PipelineStage.STORAGE_FAILED, {
					error: message,
				})
				await documentRepository.updateById(document.id, {
					status: DocumentStatus.FAILED,
					errorMessage: `storage_failed: ${message}`,
				})
				throw error
			}
		}

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

	private async persistOriginal(
		documentId: number,
		fileBuffer: Buffer,
		meta: { filename: string; fileHash: string; caseId: number | null },
	): Promise<void> {
		if (!this.objectStorage) return

		const contentType = getMimeType(meta.filename)
		const storageKey = buildDocumentStorageKey({
			caseId: meta.caseId,
			documentId,
			fileHash: meta.fileHash,
			filename: meta.filename,
		})
		const storageBucket = process.env.S3_BUCKET ?? 'the-eye-documents'

		await this.objectStorage.putObject(storageKey, fileBuffer, contentType)
		await documentRepository.updateById(documentId, {
			storageKey,
			storageBucket,
			contentType,
		})

		await logPipelineStage(documentId, PipelineStage.STORAGE_PERSISTED, {
			storageKey,
			storageBucket,
			contentType,
			bytes: fileBuffer.length,
			provider: process.env.STORAGE_PROVIDER ?? 'minio',
		})
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
