export const JUDGMENTS_QUEUE = 'judgments'

export interface JudgmentFileJob {
	jobId: string
	checksum: string
	storageKey: string
	relativePath: string
	/** Document collection. Defaults to 'judgments'. */
	collection: string
}

export interface JudgmentQueueOptions {
	attempts?: number
	backoffDelayMs?: number
}

export function judgmentJobOptions(options: JudgmentQueueOptions = {}): {
	attempts: number
	backoff: { type: string; delay: number }
	removeOnComplete: number
	removeOnFail: number
} {
	return {
		attempts: options.attempts ?? 5,
		backoff: { type: 'exponential', delay: options.backoffDelayMs ?? 2000 },
		removeOnComplete: 100,
		removeOnFail: 500,
	}
}

/**
 * Deterministic BullMQ job id for dedup. BullMQ forbids `:` in custom ids
 * ("Custom Id cannot contain :"), so the separator is `_` — unambiguous
 * because neither UUID job ids nor hex checksums contain underscores.
 */
export function judgmentJobId(job: JudgmentFileJob): string {
	return `${job.jobId}_${job.checksum}`
}

/** Prefix identifying all BullMQ jobs of one ingestion job. */
export function judgmentJobPrefix(jobId: string): string {
	return `${jobId}_`
}

/**
 * Queue topology: the default collection keeps the stable 'judgments'
 * queue; every other collection gets its own `ingest:<collection>` queue
 * so retry/backoff/visibility stay independent per document type.
 */
export function queueNameForCollection(collection: string): string {
	const normalized = collection.trim().toLowerCase()
	if (!/^[a-z0-9-]{1,64}$/.test(normalized)) {
		throw new Error(`Invalid collection: ${collection}`)
	}
	return normalized === 'judgments' ? JUDGMENTS_QUEUE : `ingest:${normalized}`
}

/** Queues the worker should consume. Defaults to judgments; extend via env. */
export function ingestionQueuesForCollections(collections: readonly string[]): string[] {
	const names = collections.map(queueNameForCollection)
	return [...new Set(names)]
}

/**
 * Parse the INGEST_COLLECTIONS env (comma-separated). Blank entries are
 * dropped; empty/missing falls back to the default judgments collection.
 */
export function ingestionCollections(env: NodeJS.ProcessEnv): string[] {
	const raw = env.INGEST_COLLECTIONS ?? 'judgments'
	const collections = raw
		.split(',')
		.map((c) => c.trim().toLowerCase())
		.filter(Boolean)
	return collections.length > 0 ? collections : ['judgments']
}
