import { createHash } from 'node:crypto'
import type { SourceConnector, SourceFile } from '../ports/source-connector'
import type { ObjectSink } from '../ports/object-sink'
import type { JobFileRecord, JobStore } from '../ports/job-store'
import { buildCollectionStorageKey, sha256Hex } from '../storage/keys'
import { DEFAULT_RETRY_POLICY, type RetryPolicy, shouldRetry } from './policy'
import type { ProgressHub } from '../progress/hub'

export interface UploadRunnerOptions {
	jobId: string
	source: string
	/** Document collection driving the storage-key prefix. */
	collection: string
	store: JobStore
	sink: ObjectSink
	hub: ProgressHub
	storageBucket: string
	retry?: RetryPolicy
	concurrency?: number
	onFileDone?: (file: JobFileRecord) => void | Promise<void>
}

async function collectBytes(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
	const parts: Uint8Array[] = []
	for await (const chunk of stream) parts.push(chunk)
	const total = parts.reduce((n, p) => n + p.length, 0)
	const out = new Uint8Array(total)
	let off = 0
	for (const p of parts) {
		out.set(p, off)
		off += p.length
	}
	return out
}

/**
 * Chunked copy → sink with progress callbacks + resume-by-checksum.
 * Files whose checksum already exists in the store with a storageKey are
 * skipped (idempotent resume); failures retry per policy then quarantine.
 */
export async function uploadDiscoveredFiles(
	connector: SourceConnector,
	files: SourceFile[],
	options: UploadRunnerOptions,
): Promise<{ uploaded: number; skipped: number; failed: number }> {
	const retry = options.retry ?? DEFAULT_RETRY_POLICY
	let uploaded = 0
	let skipped = 0
	let failed = 0

	const runOne = async (file: SourceFile): Promise<void> => {
		// Need bytes first to compute checksum when the connector lacks one.
		const stream = await connector.openRead({ sourceKey: file.sourceKey, sizeBytes: file.sizeBytes })
		const bytes = await collectBytes(stream as AsyncIterable<Uint8Array>)
		const checksum = file.checksum ?? sha256Hex(bytes)
		const existing = await options.store.getFile(options.jobId, checksum)
		if (existing?.storageKey && existing.status !== 'failed') {
			skipped += 1
			options.hub.publish({
				jobId: options.jobId,
				kind: 'file-done',
				relativePath: file.relativePath,
				checksum,
				transferredBytes: existing.bytesTransferred,
				sizeBytes: file.sizeBytes,
			})
			return
		}
		const storageKey = buildCollectionStorageKey({
			collection: options.collection,
			source: options.source,
			jobId: options.jobId,
			relativePath: file.relativePath,
			checksum,
		})
		const record: JobFileRecord = {
			id: `${options.jobId}:${checksum}`,
			jobId: options.jobId,
			collection: options.collection,
			source: options.source,
			sourceKey: file.sourceKey,
			relativePath: file.relativePath,
			filename: file.filename,
			sizeBytes: bytes.length,
			checksum,
			storageKey: null,
			status: 'staged',
			attempts: existing?.attempts ?? 0,
			lastError: null,
			bytesTransferred: 0,
		}
		await options.store.upsertFile(record)

		let attempt = 0
		for (;;) {
			attempt += 1
			try {
				let transferred = 0
				const CHUNK = 64 * 1024
				async function* chunked(): AsyncGenerator<Uint8Array, void, void> {
					for (let i = 0; i < bytes.length; i += CHUNK) {
						const slice = bytes.slice(i, i + CHUNK)
						transferred += slice.length
						options.hub.publish({
							jobId: options.jobId,
							kind: 'file-progress',
							relativePath: file.relativePath,
							checksum,
							transferredBytes: transferred,
							sizeBytes: bytes.length,
						})
						yield slice
					}
				}
				await options.sink.putObject(
					{
						key: storageKey,
						contentType: 'application/octet-stream',
						expectedBytes: bytes.length,
						onChunk: (n) => {
							void n
						},
					},
					chunked(),
				)
				await options.store.updateFile(options.jobId, checksum, {
					storageKey,
					status: 'uploaded',
					bytesTransferred: bytes.length,
					attempts: attempt,
					lastError: null,
				})
				options.hub.publish({
					jobId: options.jobId,
					kind: 'file-done',
					relativePath: file.relativePath,
					checksum,
					transferredBytes: bytes.length,
					sizeBytes: bytes.length,
				})
				uploaded += 1
				if (options.onFileDone) await options.onFileDone({ ...record, storageKey, status: 'uploaded' })
				return
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				await options.store.updateFile(options.jobId, checksum, {
					attempts: attempt,
					lastError: message,
					bytesTransferred: 0,
				})
				if (!shouldRetry(attempt, retry)) {
					await options.store.updateFile(options.jobId, checksum, { status: 'failed', lastError: message })
					options.hub.publish({
						jobId: options.jobId,
						kind: 'file-failed',
						relativePath: file.relativePath,
						checksum,
						error: message,
					})
					failed += 1
					return
				}
				// Immediate retry in-engine (backoff delay is applied by the queue layer).
			}
		}
	}

	const concurrency = Math.max(1, options.concurrency ?? 4)
	const queue = [...files]
	const workers: Array<Promise<void>> = []
	for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
		workers.push(
			(async () => {
				while (queue.length > 0) {
					const next = queue.shift() as SourceFile | undefined
					if (!next) return
					await runOne(next)
				}
			})(),
		)
	}
	await Promise.all(workers)
	return { uploaded, skipped, failed }
}

export function checksumBytes(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex')
}
