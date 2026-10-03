import { describe, expect, test } from 'bun:test'
import type { SourceConnector, SourceFile } from '../src/ports/source-connector'
import type { ObjectSink } from '../src/ports/object-sink'
import { InMemoryJobStore } from '../src/jobs/store-memory'
import { ProgressHub } from '../src/progress/hub'
import { uploadDiscoveredFiles } from '../src/transfer/uploader'
import { sha256Hex } from '../src/storage/keys'

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text)
}

function fakeConnector(files: Record<string, string>, failOpenFor: Set<string> = new Set()): SourceConnector {
	return {
		kind: 'local-fs',
		async *listFiles() {
			for (const [relativePath, content] of Object.entries(files)) {
				yield {
					sourceKey: `mem://${relativePath}`,
					relativePath,
					filename: relativePath.split('/').pop() as string,
					sizeBytes: bytes(content).length,
					mtimeMs: null,
					checksum: null,
				} satisfies SourceFile
			}
		},
		async openRead(handle) {
			const rel = handle.sourceKey.replace('mem://', '')
			if (failOpenFor.has(rel)) throw new Error(`open failed: ${rel}`)
			const content = files[rel] as string
			async function* gen() {
				yield bytes(content)
			}
			return gen()
		},
	}
}

function collectingSink(failures: Map<string, number> = new Map(), seen: Uint8Array[] = []): ObjectSink & { seen: Uint8Array[] } {
	return {
		seen,
		async putObject(_options, body) {
			const key = _options.key
			const remaining = failures.get(key) ?? 0
			// Drain body regardless so progress events still fire deterministically.
			for await (const chunk of body) {
				seen.push(chunk)
			}
			if (remaining > 0) {
				failures.set(key, remaining - 1)
				throw new Error(`sink boom: ${key}`)
			}
		},
	}
}

describe('transfer/uploader — progress, retry, resume', () => {
	test('progress events are monotonic and end at sizeBytes', async () => {
		const store = new InMemoryJobStore()
		const hub = new ProgressHub()
		const progress: number[] = []
		hub.subscribe('job1', (e) => {
			if (e.kind === 'file-progress') progress.push(e.transferredBytes as number)
		})
		const connector = fakeConnector({ 'a.pdf': 'x'.repeat(200_000) })
		const files: SourceFile[] = []
		for await (const f of connector.listFiles({ root: 'mem' })) files.push(f)
		await store.createJob({
			id: 'job1', source: 'local', root: 'mem', collection: 'judgments', status: 'transferring',
			totalFiles: 1, doneFiles: 0, failedFiles: 0, totalBytes: 0,
			transferredBytes: 0, createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(), lastError: null,
		})
		const result = await uploadDiscoveredFiles(connector, files, {
			jobId: 'job1', source: 'local', collection: 'judgments', store, sink: collectingSink(), hub, storageBucket: 'judgments',
		})
		expect(result).toEqual({ uploaded: 1, skipped: 0, failed: 0 })
		expect(progress.length).toBeGreaterThan(1)
		for (let i = 1; i < progress.length; i++) {
			expect(progress[i] as number).toBeGreaterThan(progress[i - 1] as number)
		}
		expect(progress[progress.length - 1]).toBe(200_000)
	})

	test('checksum-resume skips already-stored rows (idempotent rerun)', async () => {
		const store = new InMemoryJobStore()
		const hub = new ProgressHub()
		await store.createJob({
			id: 'job1', source: 'local', root: 'mem', collection: 'judgments', status: 'transferring',
			totalFiles: 1, doneFiles: 0, failedFiles: 0, totalBytes: 0,
			transferredBytes: 0, createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(), lastError: null,
		})
		const checksum = sha256Hex(bytes('hello'))
		await store.upsertFile({
			id: 'job1:' + checksum, jobId: 'job1', collection: 'judgments', source: 'local', sourceKey: 'mem://a.pdf',
			relativePath: 'a.pdf', filename: 'a.pdf', sizeBytes: 5, checksum,
			storageKey: 'judgments/local/job1/a-deadbeef.pdf', status: 'uploaded',
			attempts: 1, lastError: null, bytesTransferred: 5,
		})
		let puts = 0
		const sink: ObjectSink = { async putObject() { puts += 1 } }
		const connector = fakeConnector({ 'a.pdf': 'hello' })
		const files: SourceFile[] = []
		for await (const f of connector.listFiles({ root: 'mem' })) files.push(f)
		const result = await uploadDiscoveredFiles(connector, files, {
			jobId: 'job1', source: 'local', collection: 'judgments', store, sink, hub, storageBucket: 'judgments',
		})
		expect(result.skipped).toBe(1)
		expect(puts).toBe(0)
	})

	test('retry exhaustion quarantines the file (status failed + lastError)', async () => {
		const store = new InMemoryJobStore()
		const hub = new ProgressHub()
		const failedEvents: string[] = []
		hub.subscribe('job1', (e) => {
			if (e.kind === 'file-failed') failedEvents.push(e.relativePath as string)
		})
		await store.createJob({
			id: 'job1', source: 'local', root: 'mem', collection: 'judgments', status: 'transferring',
			totalFiles: 1, doneFiles: 0, failedFiles: 0, totalBytes: 0,
			transferredBytes: 0, createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(), lastError: null,
		})
		const connector = fakeConnector({ 'bad.pdf': 'data' })
		const files: SourceFile[] = []
		for await (const f of connector.listFiles({ root: 'mem' })) files.push(f)
		const sink = collectingSink(new Map([[`judgments/local/job1/bad-${sha256Hex(bytes('data')).slice(0, 8)}.pdf`, 99]]))
		const result = await uploadDiscoveredFiles(connector, files, {
			jobId: 'job1', source: 'local', collection: 'judgments', store, sink, hub, storageBucket: 'judgments',
			retry: { maxAttempts: 2, baseMs: 1, maxMs: 2 },
		})
		expect(result.failed).toBe(1)
		const rows = await store.listFiles('job1')
		expect(rows[0]?.status).toBe('failed')
		expect(rows[0]?.attempts).toBe(2)
		expect(rows[0]?.lastError).toMatch(/sink boom/)
		expect(failedEvents).toEqual(['bad.pdf'])
	})

	test('transient failure then success records attempts correctly', async () => {
		const store = new InMemoryJobStore()
		const hub = new ProgressHub()
		await store.createJob({
			id: 'job1', source: 'local', root: 'mem', collection: 'judgments', status: 'transferring',
			totalFiles: 1, doneFiles: 0, failedFiles: 0, totalBytes: 0,
			transferredBytes: 0, createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(), lastError: null,
		})
		const connector = fakeConnector({ 'flaky.pdf': 'data' })
		const files: SourceFile[] = []
		for await (const f of connector.listFiles({ root: 'mem' })) files.push(f)
		const sink = collectingSink(new Map([[`judgments/local/job1/flaky-${sha256Hex(bytes('data')).slice(0, 8)}.pdf`, 1]]))
		const result = await uploadDiscoveredFiles(connector, files, {
			jobId: 'job1', source: 'local', collection: 'judgments', store, sink, hub, storageBucket: 'judgments',
			retry: { maxAttempts: 3, baseMs: 1, maxMs: 2 },
		})
		expect(result.uploaded).toBe(1)
		const rows = await store.listFiles('job1')
		expect(rows[0]?.attempts).toBe(2)
	})
})
