import { stat } from 'node:fs/promises'
import { Queue } from 'bullmq'
import { LocalFsConnector } from '@workspace/ingestion'
import { S3Connector } from '@workspace/ingestion'
import { S3Client } from '@aws-sdk/client-s3'
import { DrizzleJobStore } from '@workspace/ingestion'
import { IngestionOrchestrator } from '@workspace/ingestion'
import { ProgressHub } from '@workspace/ingestion'
import { buildJob, normalizeCollection, enqueuePendingFiles } from '@workspace/ingestion'
import { judgmentJobId, judgmentJobOptions, queueNameForCollection } from '@workspace/ingestion'
import { consoleLogger } from '@workspace/ingestion'
import type { SourceConnector } from '@workspace/ingestion'
import type { ObjectSink } from '@workspace/ingestion'
import type { JobStore } from '@workspace/ingestion'
import type { EnqueueFile } from '@workspace/ingestion'
import type { IngestionJob } from '@workspace/ingestion'
import { judgmentDocumentRepository, ingestionJobRepository, redisConnectionOptions } from '@workspace/shared'
import type { JudgmentDocument } from '@workspace/shared'
import { S3ObjectSink, isDurableSinkConfigured } from './sink'

export type IngestionSource = 'local-fs' | 's3'

/** In-memory object store for version 1. Tests use `withDeps` to replace it with S3. */
class MemorySink implements ObjectSink {
	readonly objects = new Map<string, Uint8Array>()
	async putObject(options: { key: string }, body: AsyncIterable<Uint8Array>): Promise<void> {
		const parts: Uint8Array[] = []
		for await (const chunk of body) parts.push(chunk)
		const total = parts.reduce((n, p) => n + p.length, 0)
		const out = new Uint8Array(total)
		let off = 0
		for (const p of parts) {
			out.set(p, off)
			off += p.length
		}
		this.objects.set(options.key, out)
	}
}

interface IngestionDeps {
	connectorFor?: (source: IngestionSource, root: string) => SourceConnector
	sink?: ObjectSink
	enqueue?: (file: EnqueueFile) => Promise<void>
}

const sharedHub = new ProgressHub()
const sharedSink = new MemorySink()

/** Hold one BullMQ queue per collection. Create each queue on first use. */
const queueCache = new Map<string, Queue>()

export function getIngestionQueue(collection: string): Queue {
	const name = queueNameForCollection(collection)
	let queue = queueCache.get(name)
	if (!queue) {
		queue = new Queue(name, { connection: redisConnectionOptions() })
		queueCache.set(name, queue)
	}
	return queue
}

/** Close cached queues for shutdown. Then clear the cache. */
export async function closeIngestionQueues(): Promise<void> {
	for (const queue of queueCache.values()) {
		await queue.close().catch(() => {})
	}
	queueCache.clear()
}

/** Clear cached queues between tests. Use only in tests. */
export const closeIngestionQueuesForTests = closeIngestionQueues

async function enqueueFile(file: EnqueueFile): Promise<void> {
	const queue = getIngestionQueue(file.collection)
	const log = consoleLogger('INGEST-API')
	log.info('enqueue-file', {
		queue: queue.name,
		jobId: file.jobId,
		checksum: file.checksum,
		relativePath: file.relativePath,
	})
	await queue.add(
		'ingest-file',
		{
			jobId: file.jobId,
			checksum: file.checksum,
			storageKey: file.storageKey,
			relativePath: file.relativePath,
			collection: file.collection,
		},
		{ ...judgmentJobOptions(), jobId: judgmentJobId(file) },
	)
}

function asRecord(row: object): Record<string, unknown> {
	return row as unknown as Record<string, unknown>
}

/** Store jobs in ingestion_jobs. Store files in judgment_documents. Both stores survive restarts. */
export function createDurableStore(): JobStore {
	return new DrizzleJobStore({
		jobs: {
			findById: async (id) => {
				const row = await ingestionJobRepository.findById(id)
				return row ? asRecord(row) : null
			},
			list: async () => {
				const result = await ingestionJobRepository.findMany([], { limit: 1000 })
				return result.data.map(asRecord)
			},
			create: async (row) => asRecord(await ingestionJobRepository.createJob(asRecord(row) as never)),
			update: async (id, patch) => {
				await ingestionJobRepository.updateJob(id, asRecord(patch) as never)
			},
		},
		files: {
			findByChecksum: async (checksum) => {
				const row = await judgmentDocumentRepository.findByChecksum(checksum)
				return row ? asRecord(row) : null
			},
			create: async (row) => asRecord(await judgmentDocumentRepository.create(asRecord(row) as never)),
			upsert: async (row) =>
				asRecord(await judgmentDocumentRepository.upsertByChecksum(asRecord(row) as never)),
			update: async (checksum, patch) => {
				await judgmentDocumentRepository.updateByChecksum(
					checksum,
					asRecord(patch) as Partial<JudgmentDocument>,
				)
			},
			listByJob: async (jobId) => (await judgmentDocumentRepository.findByJobId(jobId)).map(asRecord),
		},
	})
}

export function validateCreateJob(input: { source: string; root: string; collection?: string }): asserts input is {
	source: IngestionSource
	root: string
	collection?: string
} {
	if (input.source !== 'local-fs' && input.source !== 's3') {
		throw new Error(`Unsupported source: ${input.source}`)
	}
	if (!input.root || input.root.trim().length === 0) {
		throw new Error('root must not be empty')
	}
	if (input.collection !== undefined) {
		normalizeCollection(input.collection)
	}
	if (input.source === 's3') {
		const bare = input.root.startsWith('s3://') ? input.root.slice(5) : input.root
		if (!bare.includes('/') && !bare.includes('.') && bare.length < 3) {
			throw new Error('s3 root must be s3://bucket/prefix or bucket/prefix')
		}
	}
	if (input.source === 'local-fs' && !input.root.startsWith('/')) {
		throw new Error('local-fs root must be an absolute path')
	}
}

export abstract class IngestionService {
	private static durableStore: JobStore | null = null
	/** Use durable storage by default. Storage survives restarts. Tests replace it with memory. */
	static get store(): JobStore {
		if (!this.durableStore) this.durableStore = createDurableStore()
		return this.durableStore
	}
	static set store(store: JobStore) {
		this.durableStore = store
	}
	static hub = sharedHub
	private static durableSink: ObjectSink | null = null
	private static memorySinkOverride: ObjectSink | null = null
	/** Use S3 storage when configured. Else use memory. Tests and local dev use memory. */
	static get sink(): ObjectSink {
		if (this.memorySinkOverride) return this.memorySinkOverride
		if (!this.durableSink) {
			this.durableSink = isDurableSinkConfigured() ? new S3ObjectSink() : sharedSink
		}
		return this.durableSink
	}
	static set sink(sink: ObjectSink) {
		this.memorySinkOverride = sink
	}
	static connectorFor(source: IngestionSource, root: string, deps: IngestionDeps = {}): SourceConnector {
		if (deps.connectorFor) return deps.connectorFor(source, root)
		if (source === 'local-fs') {
			if (!root.startsWith('/')) throw new Error('local-fs root must be an absolute path')
			return new LocalFsConnector()
		}
		const endpoint = process.env.S3_ENDPOINT
		const client = new S3Client({
			region: process.env.S3_REGION ?? 'us-east-1',
			...(endpoint ? { endpoint } : {}),
			forcePathStyle: true,
			credentials: {
				accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
				secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
			},
		})
		const withoutScheme = root.startsWith('s3://') ? root.slice(5) : root
		const slash = withoutScheme.indexOf('/')
		const bucket = slash < 0 ? withoutScheme : withoutScheme.slice(0, slash)
		const prefix = slash < 0 ? '' : withoutScheme.slice(slash + 1)
		return new S3Connector({ bucket, prefix, client })
	}

	static async createJob(
		input: { source: IngestionSource; root: string; collection?: string },
		deps: IngestionDeps = {},
	): Promise<IngestionJob> {
		validateCreateJob(input)
		if (input.source === 'local-fs') {
			const st = await stat(input.root).catch(() => null)
			if (!st || !st.isDirectory()) {
				throw new Error(`local root is not a directory: ${input.root}`)
			}
		}
		const job = buildJob(input)
		const connector = this.connectorFor(input.source, input.root, deps)
		const sink = deps.sink ?? this.sink
		const enqueue = deps.enqueue ?? enqueueFile
		const log = consoleLogger('INGEST-API')
		log.info('job-create-started', { jobId: job.id, source: job.source, root: job.root, collection: job.collection })
		const orchestrator = new IngestionOrchestrator()
		// Use queue mode. Discover files and upload files now.
		// Then send files to the worker. Return status 'processing'.
		// Do not keep the HTTP connection open.
		const finished = await orchestrator.runJob(job, {
			connector,
			sink,
			store: this.store,
			hub: this.hub,
			enqueue,
			logger: log,
		})
		log.info('job-create-done', {
			jobId: finished.id,
			status: finished.status,
			totalFiles: finished.totalFiles,
			doneFiles: finished.doneFiles,
			failedFiles: finished.failedFiles,
		})
		return finished
	}

	static async getJob(id: string): Promise<IngestionJob | null> {
		return this.store.getJob(id)
	}

	/**
	 * Restart a stopped job. Send each pending file to the queue again.
	 * Do not upload files again. Skip files with summaries.
	 * Returns the count of sent files and failed files.
	 */
	static async enqueueJob(
		id: string,
		deps: IngestionDeps = {},
	): Promise<{ jobId: string; enqueued: number; failed: number }> {
		const log = consoleLogger('INGEST-API')
		const job = await this.store.getJob(id)
		if (!job) {
			throw new Error(`Job not found: ${id}`)
		}
		const enqueue = deps.enqueue ?? enqueueFile
		log.info('job-enqueue-started', { jobId: id, collection: job.collection })
		const result = await enqueuePendingFiles(this.store, id, enqueue, {
			logger: log,
			onError: async (file, message) => {
				await this.store.updateFile(id, file.checksum, {
					status: 'failed',
					lastError: `enqueue failed: ${message}`,
				})
				this.hub.publish({
					jobId: id,
					kind: 'file-failed',
					relativePath: file.relativePath,
					checksum: file.checksum,
					error: message,
				})
			},
		})
		log.info('job-enqueue-done', { jobId: id, enqueued: result.enqueued, failed: result.failed })
		return { jobId: id, enqueued: result.enqueued, failed: result.failed }
	}

	static async listJobs(): Promise<IngestionJob[]> {
		return this.store.listJobs()
	}

	static async listFiles(jobId: string, limit = 100, offset = 0) {
		const files = await this.store.listFiles(jobId)
		return {
			data: files.slice(offset, offset + limit),
			pagination: { limit, offset, total: files.length },
		}
	}

	static getEvents(jobId: string, after = 0) {
		return this.hub.history(jobId, after)
	}

	/** Replace store, hub, and object store between tests. Use only in tests. */
	static resetForTests(deps: { store?: JobStore; hub?: ProgressHub; sink?: ObjectSink }): void {
		if (deps.store) this.store = deps.store
		if (deps.hub) this.hub = deps.hub
		this.memorySinkOverride = deps.sink ?? null
		this.durableSink = null
	}
}
