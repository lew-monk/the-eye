import { documentRepository } from '@workspace/shared'
import { createHash } from 'crypto'
import { validateDocumentUpload, DocumentType } from '@workspace/shared'
import { getAzureOCRService, type OCRResult } from './ocr'
import { DocumentQueue, QueueProcessingOptions } from './services/queue'
import type { Document } from '@workspace/shared'

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
			this.queue = new DocumentQueue()
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
		} = {}
	): Promise<{ documentId: number; result?: OCRResult }> {
		// Validate inputs
		const validatedMetadata = validateDocumentUpload(metadata)
		const fileHash = createHash('sha256').update(fileBuffer).digest('hex')

		const existing = await (documentRepository as any).findByFileHash(fileHash)
		if (existing && existing.status !== 'failed') {
			return { documentId: existing.id }
		}

		// Create document record
		const document = await (documentRepository as any).create({
			filename: validatedMetadata.filename,
			fileType: validatedMetadata.fileType,
			fileSize: validatedMetadata.fileSize,
			documentType: validatedMetadata.documentType,
			fileHash,
			status: this.useQueue ? 'queued' : 'processing',
		})

		const queueOptions: QueueProcessingOptions = {
			documentType: validatedMetadata.documentType,
			extractFullContent: options.extractFullContent ?? true,
			...(options.customModelId && { customModelId: options.customModelId }),
		}

		if (this.useQueue && this.queue) {
			// Queue the document for async processing
			await this.queue.addDocument(document.id, fileBuffer, queueOptions)
			return { documentId: document.id } // No result yet, will be processed async
		} else {
			// Process synchronously
			try {
				// Process with Azure
				const result = await this.azureService.processDocumentFromBuffer(document.id, fileBuffer)

				// Update document with results
				await documentRepository.updateById(document.id, {
					status: 'completed',
					processedAt: new Date(),
					structuredData: result.structuredData,
					fullContent: { content: result.content },
					confidence: result.confidence,
				})

				return { documentId: document.id, result }
			} catch (error: any) {
				await documentRepository.updateById(document.id, {
					status: 'failed',
					errorMessage: error.message,
				})
				throw error
			}
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
		return documentRepository.findByStatus('processing')
	}

	async getCompletedDocuments(): Promise<Document[]> {
		return documentRepository.findByStatus('completed')
	}

	async getFailedDocuments(): Promise<Document[]> {
		return documentRepository.findByStatus('failed')
	}

	async close(): Promise<void> {
		if (this.queue) {
			await this.queue.close()
		}
	}
}

// Singleton instance
let ocrServiceInstance: OCRService | null = null;

export function getOCRService(config?: OCRServiceConfig): OCRService {
	if (!ocrServiceInstance) {
		ocrServiceInstance = new OCRService(config);
	}
	return ocrServiceInstance;
}
