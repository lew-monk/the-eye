import { DocumentRepository } from '@workspace/shared'
import { ProcessingOptions, DocumentExtractionResult } from './types'
import { AzureOCRService, OCRResult } from '../..'
import { DocumentStatus, pipelineLog } from '../../utils/pipeline-log'

export class DocumentProcessor {
	private azureService = new AzureOCRService()
	private docRepo = new DocumentRepository()

	async processDocument(fileBuffer: Buffer, options: ProcessingOptions): Promise<DocumentExtractionResult> {
		const startTime = Date.now()
		const documentId = options.documentId!

		try {
			pipelineLog(documentId, 'processor_started', {
				bytes: fileBuffer.byteLength,
				documentType: options.documentType,
			})

			const result: OCRResult = await this.azureService.processDocumentFromBuffer(documentId, fileBuffer)

			const extractionResult: DocumentExtractionResult = {
				content: result.content,
				structured: result.structuredData || {},
				confidence: result.confidence,
				metadata: {
					processedAt: new Date(),
					processingTime: Date.now() - startTime,
				},
				...(result.extractedFields ? { extractedFields: result.extractedFields } : {}),
			}

			pipelineLog(documentId, 'processor_finished', {
				ms: Date.now() - startTime,
				contentLength: result.content.length,
				confidence: result.confidence,
			})

			return extractionResult
		} catch (error) {
			await this.docRepo.updateById(documentId, {
				status: DocumentStatus.FAILED,
				errorMessage: error instanceof Error ? error.message : 'Unknown error',
			})
			throw error
		}
	}
}
