import { Queue, Worker, QueueEvents } from 'bullmq'
import { BullMQClient } from '@workspace/shared'
import { documentRepository } from '@workspace/shared'
import { DocumentProcessor } from '../ocr'
import { QueueProcessingOptions, DocumentJobData, CoreferenceJobData, EmbeddingJobData } from './types'
import { createHash } from 'crypto'
import { DocumentStatus, PipelineStage, logPipelineStage, pipelineLog } from '../../utils/pipeline-log'

let documentQueueInstance: DocumentQueue | null = null

export function getDocumentQueue(): DocumentQueue {
	if (!documentQueueInstance) {
		documentQueueInstance = new DocumentQueue()
	}
	return documentQueueInstance
}

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

		const concurrency = Math.max(1, Number(process.env.OCR_WORKER_CONCURRENCY || 2))

		this.worker = new Worker('document-processing', this.processDocument.bind(this), {
			connection,
			concurrency,
			// Large PDF base64 jobs need long lock / timeout
			lockDuration: 30 * 60 * 1000,
		})
		this.events = new QueueEvents('document-processing', { connection })

		console.log(`✅ [DOCUMENT QUEUE] Worker concurrency: ${concurrency}`)
		this.setupEventHandlers()
	}

	async addDocument(documentId: number, fileBuffer: Buffer, options: QueueProcessingOptions): Promise<void> {
		const existing = await documentRepository.findById(documentId)
		if (!existing) {
			throw new Error(`Cannot queue OCR: document ${documentId} does not exist`)
		}

		const job = await this.queue.add(
			'process-document',
			{
				documentId,
				fileBuffer: fileBuffer.toString('base64'),
				options,
			},
			{
				// Avoid infinite retries of orphaned jobs after DB resets
				attempts: 2,
				backoff: { type: 'exponential', delay: 5000 },
				removeOnComplete: 50,
				removeOnFail: 100,
			},
		)

		await logPipelineStage(documentId, PipelineStage.QUEUED, {
			jobId: job.id,
			bytes: fileBuffer.byteLength,
			options,
		})
	}

	private async processDocument(job: any): Promise<void> {
		const { documentId, fileBuffer, options } = job.data
		const started = Date.now()

		try {
			const document = await documentRepository.findById(documentId)
			if (!document) {
				// Stale Redis job (DB wiped/reset) or deleted document — drop, do not retry forever
				console.error(
					`[DOCUMENT QUEUE] dropping job ${job.id}: document ${documentId} not found (stale job or deleted row)`,
				)
				return
			}

			const updated = await documentRepository.updateById(documentId, {
				status: DocumentStatus.PROCESSING,
			})
			if (!updated) {
				console.error(
					`[DOCUMENT QUEUE] dropping job ${job.id}: failed to mark document ${documentId} processing`,
				)
				return
			}

			await logPipelineStage(documentId, PipelineStage.WORKER_STARTED, {
				jobId: job.id,
				attempt: job.attemptsMade + 1,
				documentType: options.documentType,
				model: options.customModelId,
				filename: document.filename,
			})

			const buffer = Buffer.from(fileBuffer, 'base64')
			pipelineLog(documentId, 'buffer_decoded', {
				bytes: buffer.byteLength,
				base64Length: typeof fileBuffer === 'string' ? fileBuffer.length : 0,
			})

			const result = await this.processor.processDocument(buffer, { ...options, documentId })

			const completed = await documentRepository.updateById(documentId, {
				status: DocumentStatus.COMPLETED,
				processedAt: new Date(),
				structuredData: result.structured,
				fullContent: { content: result.content },
				confidence: result.confidence,
			})
			if (!completed) {
				throw new Error(`Document ${documentId} disappeared before results could be saved`)
			}

			const textHash = createHash('sha256').update(result.content || '').digest('hex')
			await documentRepository.updateById(documentId, { textHash })

			await logPipelineStage(documentId, PipelineStage.RESULTS_PERSISTED, {
				confidence: result.confidence,
				processingTimeMs: result.metadata.processingTime,
				contentLength: result.content?.length ?? 0,
				textHash,
			})

			const corefDedup = {
				id: `${documentId}:${textHash}`,
				ttl: 3600000,
			}

			const corefJob = await this.corefQueue.add(
				'resolve-coreference',
				{
					documentId,
					textHash,
					modelVersion: process.env.COREF_MODEL_VERSION || 'fastcoref',
				},
				{
					attempts: 3,
					backoff: { type: 'exponential', delay: 5000 },
					deduplication: corefDedup as any,
				},
			)

			await logPipelineStage(documentId, PipelineStage.COREF_QUEUED, {
				jobId: corefJob.id,
				textHash,
				modelVersion: process.env.COREF_MODEL_VERSION || 'fastcoref',
				totalMs: Date.now() - started,
			})
		} catch (error: any) {
			const message = error?.message || 'Unknown error'
			const stillThere = await documentRepository.findById(documentId)
			if (stillThere) {
				await documentRepository.updateById(documentId, {
					status: DocumentStatus.FAILED,
					errorMessage: message,
				})
				await logPipelineStage(documentId, PipelineStage.FAILED, {
					stage: 'worker',
					error: message,
					jobId: job.id,
					ms: Date.now() - started,
				})
			} else {
				console.error(
					`[DOCUMENT QUEUE] job ${job.id} failed and document ${documentId} is missing: ${message}`,
				)
			}

			throw error
		}
	}

	async addDocumentChunkToQueue(documentId: number): Promise<void> {
		await this.embeddingQueue.add(
			'generate-embeddings',
			{ documentId },
			{
				attempts: 5,
				backoff: { type: 'exponential', delay: 2000 },
			},
		)
	}

	async addDocumentToCorefQueue(documentId: number, textHash: string): Promise<void> {
		const dedupId = `${documentId}:${textHash}`
		await this.corefQueue.add(
			'resolve-coreference',
			{
				documentId,
				textHash,
				modelVersion: process.env.COREF_MODEL_VERSION || 'fastcoref',
			},
			{
				attempts: 3,
				backoff: { type: 'exponential', delay: 5000 },
				deduplication: { id: dedupId, ttl: 3600000 } as any,
			},
		)
	}

	private setupEventHandlers(): void {
		this.events.on('completed', async ({ jobId }) => {
			console.log(`[DOCUMENT QUEUE] job ${jobId} completed`)
		})

		this.events.on('failed', async ({ jobId, failedReason }) => {
			console.error(`[DOCUMENT QUEUE] job ${jobId} failed: ${failedReason}`)
		})
	}

	async close(): Promise<void> {
		await this.worker.close()
		await this.queue.close()
		await this.corefQueue.close()
		await this.embeddingQueue.close()
		await this.events.close()
		await this.client.close()
		documentQueueInstance = null
	}
}
