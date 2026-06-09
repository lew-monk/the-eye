import { DocumentRepository } from '@workspace/shared'
import { ProcessingOptions, DocumentExtractionResult } from './types'
import { AzureOCRService, OCRResult } from '../..'

export class DocumentProcessor {
	private azureService = new AzureOCRService()
	private docRepo = new DocumentRepository()

	async processDocument(fileBuffer: Buffer, options: ProcessingOptions): Promise<DocumentExtractionResult> {
		const startTime = Date.now()

		try {
			// Process with Azure (this will update the document status)
			const result: OCRResult = await this.azureService.processDocumentFromBuffer(options.documentId!, fileBuffer)

			// Transform to our result format
			const extractionResult: DocumentExtractionResult = {
				content: result.content,
				structured: result.structuredData || {},
				confidence: result.confidence,
				metadata: {
					processedAt: new Date(),
					processingTime: Date.now() - startTime
				},
				extractedFields: result.extractedFields
			}

			return extractionResult
		} catch (error) {
			// Update status to failed if not already
			await this.docRepo.updateById(options.documentId!, { status: 'failed', errorMessage: error instanceof Error ? error.message : 'Unknown error' })
			throw error
		}
	}
}
