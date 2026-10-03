import type { SourceConnector } from '../ports/source-connector'
import type { ObjectSink } from '../ports/object-sink'
import type { JobStore, JobFileRecord } from '../ports/job-store'
import type { IngestionJob } from './types'
import { discoverFiles } from '../walk/walker'
import { shouldIndexFile } from '../walk/filters'
import { uploadDiscoveredFiles } from '../transfer/uploader'
import type { ProgressHub } from '../progress/hub'
import { silentLogger, type Logger } from '../logging/logger'

export interface PipelineHooks {
	ocr?: (file: { checksum: string; storageKey: string }) => Promise<string>
	embed?: (text: string) => Promise<{ chunks: string[]; model: string }>
	summarize?: (text: string) => Promise<string>
	onFileMeta?: (file: { checksum: string; ocrText: string; summary: string }) => Promise<void> | void
}

export interface EnqueueFile {
	jobId: string
	collection: string
	checksum: string
	storageKey: string
	relativePath: string
}

export interface EnqueueResult {
	enqueued: number
	failed: number
}

export interface EnqueuePendingOptions {
	logger?: Logger
	/**
	 * Called per enqueue failure (e.g. Redis down). The file is marked
	 * failed so one bad enqueue never aborts the batch or the HTTP request.
	 */
	onError?: (file: JobFileRecord, message: string) => Promise<void> | void
}

/**
 * Enqueue every processable file of a job: has a storageKey and is not
 * already fully processed. Skipping summarized files keeps resumed/re-driven
 * jobs from duplicating worker jobs. Per-file enqueue failures are reported
 * via onError and counted — never thrown — so a Redis blip fails files, not jobs.
 */
export async function enqueuePendingFiles(
	store: JobStore,
	jobId: string,
	enqueue: (file: EnqueueFile) => Promise<void>,
	options: EnqueuePendingOptions = {},
): Promise<EnqueueResult> {
	const log = options.logger ?? silentLogger()
	const files = await store.listFiles(jobId)
	let enqueued = 0
	let failed = 0
	for (const file of files) {
		if (!file.storageKey) continue
		if (file.status === 'summarized') continue
		try {
			await enqueue({
				jobId,
				collection: file.collection,
				checksum: file.checksum,
				storageKey: file.storageKey,
				relativePath: file.relativePath,
			})
			enqueued += 1
		} catch (error) {
			failed += 1
			const message = error instanceof Error ? error.message : String(error)
			log.error('enqueue-failed', { jobId, checksum: file.checksum, relativePath: file.relativePath, error: message })
			await options.onError?.(file, message)
		}
	}
	return { enqueued, failed }
}

export interface RunJobOptions {
	connector: SourceConnector
	sink: ObjectSink
	store: JobStore
	hub: ProgressHub
	hooks?: PipelineHooks
	/**
	 * Queue-backed mode: when provided, uploaded files are enqueued for
	 * async processing and runJob returns with status 'processing' instead
	 * of running the inline hooks loop. Files already fully processed
	 * (summarized) are not re-enqueued.
	 */
	enqueue?: (file: EnqueueFile) => Promise<void>
	/** Structured logger. Defaults to silent; hosts pass a console logger. */
	logger?: Logger
}

/**
 * State machine: discovered → staged → uploaded → ocr → embedded →
 * summarized / failed. Each step persists to the store and emits hub
 * events so polling + SSE observe identical ordering.
 */
export class IngestionOrchestrator {
	async runJob(job: IngestionJob, options: RunJobOptions): Promise<IngestionJob> {
		const { connector, sink, store, hub, hooks } = options
		const log = options.logger ?? silentLogger()
		log.info('job-started', { jobId: job.id, source: job.source, root: job.root, collection: job.collection })
		await store.createJob({ ...job, status: 'discovering', updatedAt: new Date().toISOString() })
		hub.publish({ jobId: job.id, kind: 'job-started' })

		const discovered = []
		try {
			for await (const file of discoverFiles(connector, { root: job.root })) {
				if (!shouldIndexFile(file)) continue
				hub.publish({
					jobId: job.id,
					kind: 'file-discovered',
					relativePath: file.relativePath,
					sizeBytes: file.sizeBytes,
				})
				discovered.push(file)
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			await store.updateJob(job.id, { status: 'failed', lastError: message })
			hub.publish({ jobId: job.id, kind: 'job-failed', error: message })
			throw error
		}

		await store.updateJob(job.id, {
			status: 'transferring',
			totalFiles: discovered.length,
			totalBytes: discovered.reduce((n, f) => n + f.sizeBytes, 0),
		})

		const result = await uploadDiscoveredFiles(connector, discovered, {
			jobId: job.id,
			source: job.source,
			collection: job.collection,
			store,
			sink,
			hub,
			storageBucket: 'judgments',
		})

		const current = (await store.getJob(job.id)) as IngestionJob
		const failedFiles = result.failed
		const doneFiles = result.uploaded + result.skipped
		log.info('files-uploaded', {
			jobId: job.id,
			uploaded: result.uploaded,
			skipped: result.skipped,
			failed: result.failed,
		})

		if (failedFiles > 0 && doneFiles === 0) {
			await store.updateJob(job.id, { status: 'failed', failedFiles, doneFiles })
			hub.publish({ jobId: job.id, kind: 'job-failed', error: `${failedFiles} files failed` })
			return (await store.getJob(job.id)) as IngestionJob
		}

		if (discovered.length === 0) {
			await store.updateJob(job.id, { status: 'done', doneFiles: 0, failedFiles: 0 })
			hub.publish({ jobId: job.id, kind: 'job-done' })
			log.info('job-done-empty', { jobId: job.id })
			return (await store.getJob(job.id)) as IngestionJob
		}

		await store.updateJob(job.id, {
			status: 'processing',
			doneFiles,
			failedFiles,
			transferredBytes: current.transferredBytes,
		})

		// Queue-backed mode: hand uploaded files to the worker and return early.
		// Enqueue failures mark files (never the HTTP request) as failed.
		if (options.enqueue) {
			const { enqueued, failed: enqueueFailed } = await enqueuePendingFiles(store, job.id, options.enqueue, {
				logger: log,
				onError: async (file, message) => {
					await store.updateFile(job.id, file.checksum, {
						status: 'failed',
						lastError: `enqueue failed: ${message}`,
					})
					hub.publish({
						jobId: job.id,
						kind: 'file-failed',
						relativePath: file.relativePath,
						checksum: file.checksum,
						error: message,
					})
				},
			})
			log.info('files-queued', { jobId: job.id, enqueued, failed: enqueueFailed })
			const totalFailed = failedFiles + enqueueFailed
			if (enqueued === 0 && totalFailed > 0) {
				await store.updateJob(job.id, {
					status: 'failed',
					doneFiles,
					failedFiles: totalFailed,
					lastError: 'All files failed to enqueue; see file lastError values',
				})
				hub.publish({ jobId: job.id, kind: 'job-failed', error: 'enqueue failed for all files' })
			} else {
				await store.updateJob(job.id, { failedFiles: totalFailed })
				hub.publish({ jobId: job.id, kind: 'files-queued', relativePath: `${enqueued} files queued` })
			}
			return (await store.getJob(job.id)) as IngestionJob
		}

		// OCR → embed → summarize per uploaded file (hooks injected; no-ops in v1 without models).
		const files = await store.listFiles(job.id)
		for (const file of files) {
			if (file.status !== 'uploaded' || !file.storageKey) continue
			try {
				await store.updateFile(job.id, file.checksum, { status: 'ocr' })
				const ocrText = hooks?.ocr
					? await hooks.ocr({ checksum: file.checksum, storageKey: file.storageKey })
					: ''
				await store.updateFile(job.id, file.checksum, { status: 'embedded' })
				const embedded = hooks?.embed ? await hooks.embed(ocrText) : { chunks: [], model: 'none' }
				void embedded
				await store.updateFile(job.id, file.checksum, { status: 'summarized' })
				const summary = hooks?.summarize ? await hooks.summarize(ocrText) : ''
				if (hooks?.onFileMeta) await hooks.onFileMeta({ checksum: file.checksum, ocrText, summary })
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				await store.updateFile(job.id, file.checksum, { status: 'failed', lastError: message })
				hub.publish({ jobId: job.id, kind: 'file-failed', relativePath: file.relativePath, checksum: file.checksum, error: message })
			}
		}

		const after = await store.listFiles(job.id)
		const failedAfter = after.filter((f) => f.status === 'failed').length
		const finalStatus = failedAfter === 0 ? 'done' : failedAfter === after.length ? 'failed' : 'partial'
		await store.updateJob(job.id, {
			status: finalStatus,
			doneFiles: after.length - failedAfter,
			failedFiles: failedAfter,
		})
		if (finalStatus === 'done') {
			hub.publish({ jobId: job.id, kind: 'job-done' })
		} else {
			hub.publish({ jobId: job.id, kind: 'job-failed', error: `${failedAfter} files failed` })
		}
		return (await store.getJob(job.id)) as IngestionJob
	}
}
