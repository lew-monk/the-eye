import { DocumentType } from '@workspace/shared'

export interface ProcessingOptions {
	documentType: DocumentType
	extractFullContent: boolean
	customModelId?: string
	documentId: number
}

export interface DocumentExtractionResult {
	content: string
	structured: Record<string, any>
	confidence: number
	metadata: {
		processedAt: Date
		processingTime: number
	},
	extractedFields?: Record<string, any>
}
