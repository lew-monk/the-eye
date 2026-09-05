import { eq } from 'drizzle-orm'
import { BaseRepository } from './base'
import { documents, processingLogs, type Document, type NewDocument, type NewProcessingLog, type ProcessingLog } from '../schemas'
import { DocumentType } from '../validation'

export class DocumentRepository extends BaseRepository<Document, NewDocument> {
	constructor() {
		super(documents)
	}

	// Override to use createdAt as default sort field
	override async findMany(conditions: any[] = [], options: any = {}) {
		const { orderField = 'createdAt', ...restOptions } = options
		return super.findMany(conditions, { ...restOptions, orderField })
	}

	// Document-specific methods
	async findByStatus(status: string): Promise<Document[]> {
		const result = await this.findMany([eq(documents.status, status)], { limit: 1000 })
		return result.data
	}

	async findByDocumentType(documentType: DocumentType): Promise<Document[]> {
		const result = await this.findMany([eq(documents.documentType, documentType)], { limit: 1000 })
		return result.data
	}

	async findByCaseNumber(caseNumber: string): Promise<Document[]> {
		const result = await this.findMany([eq(documents.caseNumber, caseNumber)], { limit: 1000 })
		return result.data
	}

	async findByCaseId(caseId: number): Promise<Document[]> {
		const result = await this.findMany([eq(documents.caseId, caseId)], { limit: 1000 })
		return result.data
	}

	async findByFileHash(fileHash: string): Promise<Document | null> {
		const [result] = await this.db
			.select()
			.from(documents)
			.where(eq(documents.fileHash, fileHash))
			.limit(1)
		return result as Document || null
	}

	async updateCoreference(documentId: number, coreferenceResolvedContent: Record<string, any>): Promise<Document | null> {
		return this.updateById(documentId, { coreferenceResolvedContent })
	}

	async updateStatus(id: number, status: string, errorMessage?: string): Promise<Document | null> {
		const updates: Partial<Document> = { status }
		if (status === 'completed' || status === 'processed') {
			updates.processedAt = new Date()
		}
		if (errorMessage) {
			updates.errorMessage = errorMessage
		}
		return this.updateById(id, updates)
	}

	// Processing logs
	async addProcessingLog(log: Omit<NewProcessingLog, 'id'>): Promise<void> {
		await this.db.insert(processingLogs).values(log)
	}

	async getProcessingLogs(documentId: number): Promise<ProcessingLog[]> {
		return this.db
			.select()
			.from(processingLogs)
			.where(eq(processingLogs.documentId, documentId))
			.orderBy(processingLogs.createdAt)
	}

	async getProcessingStats(): Promise<{
		total: number
		pending: number
		processing: number
		completed: number
		failed: number
	}> {
		const total = await this.count()
		const pending = await this.count([eq(documents.status, 'pending')])
		const processing = await this.count([eq(documents.status, 'processing')])
		const completed = await this.count([eq(documents.status, 'completed')])
		const failed = await this.count([eq(documents.status, 'failed')])

		return {
			total,
			pending,
			processing,
			completed,
			failed,
		}
	}
}
