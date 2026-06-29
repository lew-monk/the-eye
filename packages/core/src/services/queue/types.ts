import { DocumentType } from '@workspace/shared'

export interface DocumentJobData {
	documentId: number
	fileBuffer: string // base64 encoded
	options: QueueProcessingOptions
}

export interface CoreferenceJobData {
	documentId: number
	textHash: string
	modelVersion: string
}

export interface EmbeddingJobData {
	documentId: number
}

export interface QueueProcessingOptions {
	documentType: DocumentType
	extractFullContent: boolean
	customModelId?: string
}
