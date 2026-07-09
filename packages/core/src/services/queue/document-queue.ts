import { Queue, Worker, QueueEvents } from 'bullmq'
import { BullMQClient } from '@workspace/shared'
import { documentRepository } from '@workspace/shared'
import { DocumentProcessor } from '../ocr'
import { QueueProcessingOptions, DocumentJobData, CoreferenceJobData, EmbeddingJobData } from './types'
import { createHash } from 'crypto'

export class DocumentQueue {
	private queue: Queue<DocumentJobData>
	private worker: Worker<DocumentJobData>
	private events: QueueEvents
	private processor: DocumentProcessor
	private client: BullMQClient
	private corefQueue: Queue<CoreferenceJobData>
	private embeddingQueue: Queue<EmbeddingJobData>

	constructor() {
		this.client = new BullMQClient()
		this.processor = new DocumentProcessor()

		const connection = this.client.getConnection()

		console.log('🔌 [DOCUMENT QUEUE] Initializing queues...')
		this.queue = new Queue('document-processing', { connection })
		this.corefQueue = new Queue('coreference-resolution', { connection })
		this.embeddingQueue = new Queue('generate-embeddings', { connection })
		console.log('✅ [DOCUMENT QUEUE] Created queue: document-processing')
		console.log('✅ [COREF QUEUE] Created queue: coreference-resolution')
		console.log('✅ [EMBEDDING QUEUE] Created queue: generate-embeddings')

		this.worker = new Worker('document-processing', this.processDocument.bind(this), { connection })
		this.events = new QueueEvents('document-processing', { connection })

		this.setupEventHandlers()
	}

	async addDocument(documentId: number, fileBuffer: Buffer, options: QueueProcessingOptions): Promise<void> {
		await this.queue.add('process-document', {
			documentId,
			fileBuffer: fileBuffer.toString('base64'),
			options,
		})

		// Log the queuing action
		await documentRepository.addProcessingLog({
			documentId,
			action: 'queued',
			details: { options },
		})
	}

	private async processDocument(job: any): Promise<void> {
		const { documentId, fileBuffer, options } = job.data

		try {
			// Update status to processing
			await documentRepository.updateById(documentId, { status: 'processing' })

			// Log processing start
			await documentRepository.addProcessingLog({
				documentId,
				action: 'processing_started',
				details: { model: options.customModelId },
			})

			// Decode file buffer
			const buffer = Buffer.from(fileBuffer, 'base64')

			// Process document
			const result = await this.processor.processDocument(buffer, { ...options, documentId })

			// Update document with results
			await documentRepository.updateById(documentId, {
				status: 'completed',
				processedAt: new Date(),
				structuredData: result.structured,
				fullContent: { content: result.content },
				confidence: result.confidence,
			})

			const textHash = createHash('sha256').update(result.content || '').digest('hex')
			await (documentRepository as any).updateById(documentId, { textHash })

			const corefDedup = {
				id: `${documentId}:${textHash}`,
				ttl: 3600000,
			}

			console.log('📤 [COREF QUEUE] Adding job to queue:', {
				queueName: 'coreference-resolution',
				jobName: 'resolve-coreference',
				documentId,
				textHash,
				modelVersion: process.env.COREF_MODEL_VERSION || 'fastcoref'
			})

			const job = await this.corefQueue.add('resolve-coreference', {
				documentId,
				textHash,
				modelVersion: process.env.COREF_MODEL_VERSION || 'fastcoref',
			}, {
				attempts: 3,
				backoff: { type: 'exponential', delay: 5000 },
				deduplication: corefDedup as any,
			})

			console.log('✅ [COREF QUEUE] Job added successfully:', {
				jobId: job.id,
				documentId,
				queueName: 'coreference-resolution'
			})

			// Log successful completion
			await documentRepository.addProcessingLog({
				documentId,
				action: 'entity_extraction_pending',
				details: {
					confidence: result.confidence,
					processingTime: result.metadata.processingTime,
				},
			})

		} catch (error: any) {
			// Update status to failed
			await documentRepository.updateById(documentId, {
				status: 'failed',
				errorMessage: error.message,
			})

			// Log error
			await documentRepository.addProcessingLog({
				documentId,
				action: 'processing_failed',
				details: { error: error.message },
			})

			throw error
		}
	}

	async addDocumentChunkToQueue(documentId: number): Promise<void> {
		await this.embeddingQueue.add('generate-embeddings', { documentId }, {
			attempts: 5,
			backoff: { type: 'exponential', delay: 2000 },
		})
	}

	async addDocumentToCorefQueue(documentId: number, textHash: string): Promise<void> {
		const dedupId = `${documentId}:${textHash}`
		await this.corefQueue.add('resolve-coreference', {
			documentId,
			textHash,
			modelVersion: process.env.COREF_MODEL_VERSION || 'fastcoref',
		}, {
			attempts: 3,
			backoff: { type: 'exponential', delay: 5000 },
			deduplication: { id: dedupId, ttl: 3600000 } as any,
		})
	}

	private setupEventHandlers(): void {
		this.events.on('completed', async ({ jobId }) => {
			console.log(`Job ${jobId} completed successfully`)
		})

		this.events.on('failed', async ({ jobId, failedReason }) => {
			console.error(`Job ${jobId} failed: ${failedReason}`)
		})
	}

	async close(): Promise<void> {
		await this.worker.close()
		await this.queue.close()
		await this.corefQueue.close()
		await this.embeddingQueue.close()
		await this.events.close()
		await this.client.close()
	}
}
