import { Worker, type Job } from 'bullmq'
import type { JobStore } from '../ports/job-store'
import type { ProgressHub } from '../progress/hub'
import { consoleLogger, type Logger } from '../logging/logger'
import { buildSummaryPrompt, chunkText, hashText, type EmbedClient, type SummaryClient } from './meta'
import { ingestionQueuesForCollections, type JudgmentFileJob } from './judgment-queue'

export interface JudgmentWorkerOcr {
	extractText(bytes: Uint8Array, filename: string): Promise<string>
}

export interface JudgmentWorkerEmbed {
	embed(texts: string[]): Promise<{ vectors: number[][]; model: string; provider?: string }>
}

export interface JudgmentChunkWrite {
	index: number
	text: string
	textHash: string
	embedding: number[] | null
	model: string | null
	provider: string | null
	dimensions: number | null
}

export interface JudgmentDocStore {
	upsertJudgment(row: {
		collection: string
		source: string
		sourceKey: string
		relativePath: string
		filename: string
		sizeBytes: number
		checksum: string
		storageKey: string
		status: string
		jobId: string
	}): Promise<{ id: number }>
	replaceChunks(judgmentId: number, chunks: JudgmentChunkWrite[]): Promise<void>
	updateJudgment(
		id: number,
		patch: { status?: string; ocrText?: string; summary?: string; lastError?: string | null },
	): Promise<void>
}

export interface JudgmentWorkerSink {
	getBytes(storageKey: string): Promise<Uint8Array>
}

export type WorkerStage = 'downloaded' | 'ocr' | 'embedded' | 'processed'

export interface JudgmentWorkerDeps {
	store: JobStore
	docs: JudgmentDocStore
	sink: JudgmentWorkerSink
	ocr: JudgmentWorkerOcr
	embed: JudgmentWorkerEmbed
	summarize: SummaryClient
	hub?: ProgressHub
	chunkSize?: number
	chunkOverlap?: number
	/** Stage hook — the BullMQ host wires it to job.updateProgress. */
	onStage?: (stage: WorkerStage, pct: number) => void | Promise<void>
	/** Structured logger. Defaults to console; inject silent/memory in tests. */
	logger?: Logger
}

export type ProcessFileOutcome =
	| { status: 'summarized'; judgmentId: number; chunks: number }
	| { status: 'skipped' }

/**
 * Run one pipeline stage, tagging failures with the stage name so
 * lastError values are self-diagnosing (e.g. `[summarize] 403 …` points
 * straight at the chat-model key, not OCR or embeddings).
 */
async function stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn()
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		throw new Error(`[${name}] ${message}`)
	}
}

/**
 * Process one queued file: download → OCR → chunk+embed → summarize →
 * persist. Pure orchestration over injected deps — no BullMQ/Redis needed,
 * so every branch is unit-testable. Throws on failure (BullMQ retries);
 * the file row is already marked failed, so a retry resumes cleanly and
 * already-summarized redeliveries are skipped.
 */
export async function processJudgmentFile(
	job: JudgmentFileJob,
	deps: JudgmentWorkerDeps,
): Promise<ProcessFileOutcome> {
	const record = await deps.store.getFile(job.jobId, job.checksum)
	const log = deps.logger ?? consoleLogger('INGEST-WORKER')
	const fileRef = { jobId: job.jobId, checksum: job.checksum, relativePath: job.relativePath }
	if (!record) {
		log.error('file-record-missing', { ...fileRef, storageKey: job.storageKey })
		throw new Error(`File record missing for ${job.jobId}:${job.checksum} (stale queue job)`)
	}
	if (record.status === 'summarized') {
		log.info('file-skipped-already-summarized', { ...fileRef, collection: record.collection })
		return { status: 'skipped' }
	}
	log.info('file-started', {
		...fileRef,
		collection: record.collection,
		sizeBytes: record.sizeBytes,
		attempt: record.attempts + 1,
	})
	const storageKey = record.storageKey ?? job.storageKey
	let judgmentId: number | null = null
	const report = async (stage: WorkerStage, pct: number): Promise<void> => {
		await deps.onStage?.(stage, pct)
	}
	try {
		const startedAt = Date.now()
		await deps.store.updateFile(job.jobId, job.checksum, { status: 'ocr', attempts: record.attempts + 1 })
		const bytes = await stage('download', () => deps.sink.getBytes(storageKey))
		log.info('file-downloaded', { ...fileRef, bytes: bytes.length, ms: Date.now() - startedAt })
		await report('downloaded', 15)
		const ocrStarted = Date.now()
		const text = await stage('ocr', () => deps.ocr.extractText(bytes, record.filename))
		if (!text.trim()) {
			throw new Error(`OCR produced no text for ${record.relativePath}`)
		}
		log.info('ocr-completed', { ...fileRef, chars: text.length, ms: Date.now() - ocrStarted })

		const texts = chunkText(text, deps.chunkSize, deps.chunkOverlap)
		await report('ocr', 35)
		const embedStarted = Date.now()
		const embedded = texts.length > 0
			? await stage('embed', () => deps.embed.embed(texts))
			: { vectors: [], model: 'none' }
		if (embedded.vectors.length !== texts.length) {
			throw new Error(
				`Embedder returned ${embedded.vectors.length} vectors for ${texts.length} chunks (provider truncation?)`,
			)
		}
		log.info('embed-completed', {
			...fileRef,
			chunks: texts.length,
			model: embedded.model,
			dimensions: embedded.vectors[0]?.length ?? 0,
			ms: Date.now() - embedStarted,
		})

		const doc = await stage('persist', () =>
			deps.docs.upsertJudgment({
				collection: record.collection,
				source: record.source,
				sourceKey: record.sourceKey,
				relativePath: record.relativePath,
				filename: record.filename,
				sizeBytes: record.sizeBytes,
				checksum: record.checksum,
				storageKey,
				status: 'embedded',
				jobId: job.jobId,
			}),
		)
		judgmentId = doc.id
		log.info('judgment-upserted', { ...fileRef, judgmentId: doc.id })
		await stage('persist', () =>
			deps.docs.replaceChunks(
				doc.id,
				texts.map((chunk, index) => ({
					index,
					text: chunk,
					textHash: hashText(chunk),
					embedding: embedded.vectors[index] ?? null,
					model: embedded.model,
					provider: embedded.provider ?? null,
					dimensions: embedded.vectors[index]?.length ?? null,
				})),
			),
		)
		await deps.store.updateFile(job.jobId, job.checksum, { status: 'embedded' })
		await report('embedded', 70)

		const summaryStarted = Date.now()
		const summary = await stage('summarize', () => deps.summarize.summarize(buildSummaryPrompt(text)))
		log.info('summarize-completed', { ...fileRef, summaryChars: summary.length, ms: Date.now() - summaryStarted })
		await deps.docs.updateJudgment(doc.id, { status: 'summarized', ocrText: text, summary, lastError: null })
		await deps.store.updateFile(job.jobId, job.checksum, { status: 'summarized', lastError: null })

		await finalizeJobAggregates(deps.store, job.jobId)
		log.info('file-summarized', { ...fileRef, judgmentId: doc.id, chunks: texts.length, ms: Date.now() - startedAt })
		return { status: 'summarized', judgmentId: doc.id, chunks: texts.length }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		log.error('file-failed', { ...fileRef, judgmentId, error: message })
		await deps.store.updateFile(job.jobId, job.checksum, { status: 'failed', lastError: message })
		if (judgmentId !== null) {
			await deps.docs.updateJudgment(judgmentId, { status: 'failed', lastError: message })
		}
		deps.hub?.publish({
			jobId: job.jobId,
			kind: 'file-failed',
			relativePath: record.relativePath,
			checksum: job.checksum,
			error: message,
		})
		throw error
	}
}

/**
 * Recompute job aggregates from file rows. Idempotent — safe to run after
 * every file (including failed attempts); a later success re-finalizes.
 */
export async function finalizeJobAggregates(store: JobStore, jobId: string): Promise<void> {
	const files = await store.listFiles(jobId)
	if (files.length === 0) return
	const failed = files.filter((f) => f.status === 'failed').length
	const unfinished = files.filter((f) => f.status !== 'summarized' && f.status !== 'failed').length
	if (unfinished > 0) {
		await store.updateJob(jobId, {
			doneFiles: files.length - failed - unfinished,
			failedFiles: failed,
		})
		return
	}
	const status = failed === 0 ? 'done' : failed === files.length ? 'failed' : 'partial'
	await store.updateJob(jobId, {
		status,
		doneFiles: files.length - failed,
		failedFiles: failed,
	})
}

export interface JudgmentWorkerHandle {
	queues: string[]
	close(): Promise<void>
}

/** Start BullMQ consumers for the given collections (default: judgments). */
export async function startJudgmentWorker(
	collections: readonly string[],
	deps: JudgmentWorkerDeps,
	options: { connection: unknown; concurrency?: number; lockDurationMs?: number },
): Promise<JudgmentWorkerHandle> {
	const log = deps.logger ?? consoleLogger('INGEST-WORKER')
	const concurrency = Math.max(1, options.concurrency ?? 2)
	const queues = ingestionQueuesForCollections(collections)
	log.info('worker-starting', { queues: queues.join(','), concurrency })
	const workers = queues.map((queueName) => {
		const worker = new Worker<JudgmentFileJob, ProcessFileOutcome>(
			queueName,
			async (bullJob: Job<JudgmentFileJob, ProcessFileOutcome>) => {
				const outcome = await processJudgmentFile(bullJob.data, {
					...deps,
					logger: log,
					onStage: async (stage, pct) => {
						await bullJob.updateProgress({ stage, pct })
					},
				})
				if (outcome.status === 'summarized') {
					await bullJob.updateProgress({ stage: 'processed', pct: 100 })
				}
				return outcome
			},
			{
				connection: options.connection as never,
				concurrency,
				lockDuration: options.lockDurationMs ?? 30 * 60 * 1000,
			},
		)
		worker.on('completed', (bullJob, result) => {
			log.info('bulljob-completed', {
				queue: queueName,
				bullJobId: bullJob.id ?? null,
				checksum: bullJob.data.checksum,
				outcome: result.status,
				judgmentId: result.status === 'summarized' ? result.judgmentId : null,
			})
		})
		worker.on('failed', (bullJob, error) => {
			log.error('bulljob-failed', {
				queue: queueName,
				bullJobId: bullJob?.id ?? null,
				checksum: bullJob?.data.checksum ?? null,
				attemptsMade: bullJob?.attemptsMade ?? null,
				error: error.message,
			})
		})
		worker.on('error', (error) => {
			log.error('worker-error', { queue: queueName, error: error.message })
		})
		return worker
	})
	log.info('worker-listening', { queues: queues.join(',') })
	return {
		queues,
		async close() {
			log.info('worker-closing', { queues: queues.join(',') })
			for (const worker of workers) await worker.close()
		},
	}
}

export type { EmbedClient, SummaryClient }
