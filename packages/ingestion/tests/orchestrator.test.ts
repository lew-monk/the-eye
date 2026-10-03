import { describe, expect, test } from 'bun:test'
import type { SourceConnector, SourceFile } from '../src/ports/source-connector'
import type { ObjectSink } from '../src/ports/object-sink'
import { InMemoryJobStore } from '../src/jobs/store-memory'
import { ProgressHub } from '../src/progress/hub'
import { IngestionOrchestrator } from '../src/jobs/orchestrator'
import { buildJob } from '../src/index'

function memConnector(files: Record<string, string>): SourceConnector {
	return {
		kind: 'local-fs',
		async *listFiles() {
			for (const [relativePath, content] of Object.entries(files)) {
				const filename = relativePath.split('/').pop() as string
				yield {
					sourceKey: `mem://${relativePath}`,
					relativePath,
					filename,
					sizeBytes: new TextEncoder().encode(content).length,
					mtimeMs: null,
					checksum: null,
				} satisfies SourceFile
			}
		},
		async openRead(handle) {
			const rel = handle.sourceKey.replace('mem://', '')
			const content = files[rel] as string
			async function* gen() {
				yield new TextEncoder().encode(content)
			}
			return gen()
		},
	}
}

const memSink: ObjectSink = {
	async putObject(_options, body) {
		for await (const _chunk of body) {
			// drain
		}
	},
}

describe('jobs/orchestrator — end-to-end state machine', () => {
	test('happy path: discover → upload → ocr/embed/summarize → done, events ordered', async () => {
		const store = new InMemoryJobStore()
		const hub = new ProgressHub()
		const kinds: string[] = []
		hub.subscribe('job-e2e', (e) => kinds.push(e.kind))
		const seenMeta: Array<{ checksum: string; ocrText: string; summary: string }> = []
		const orchestrator = new IngestionOrchestrator()
		const final = await orchestrator.runJob(buildJob({ source: 'local', root: 'mem' }, 'job-e2e'), {
			connector: memConnector({ 'cases/a.pdf': 'content-a', 'b.pdf': 'content-b' }),
			sink: memSink,
			store,
			hub,
			hooks: {
				ocr: async () => 'ocr-text',
				embed: async () => ({ chunks: ['c1'], model: 'test-model' }),
				summarize: async () => 'summary',
				onFileMeta: async (m) => { seenMeta.push(m) },
			},
		})
		expect(final.status).toBe('done')
		expect(final.totalFiles).toBe(2)
		const rows = await store.listFiles('job-e2e')
		expect(rows.every((r) => r.status === 'summarized')).toBe(true)
		expect(seenMeta).toHaveLength(2)
		expect(kinds[0]).toBe('job-started')
		expect(kinds[kinds.length - 1]).toBe('job-done')
		expect(kinds).toContain('file-discovered')
		expect(kinds).toContain('file-done')
	})

	test('unsupported extensions are filtered before upload (no wasted sink puts)', async () => {
		const store = new InMemoryJobStore()
		const hub = new ProgressHub()
		let puts = 0
		const sink: ObjectSink = { async putObject(_o, body) { puts += 1; for await (const _c of body) { /* drain */ } } }
		const orchestrator = new IngestionOrchestrator()
		const final = await orchestrator.runJob(buildJob({ source: 'local', root: 'mem' }, 'job-filter'), {
			connector: memConnector({ 'notes.txt': 'hello', 'ok.pdf': 'pdf-bytes' }),
			sink,
			store,
			hub,
		})
		expect(final.totalFiles).toBe(1)
		expect(puts).toBe(1)
	})

	test('all files failing → job failed (not stuck in processing)', async () => {
		const store = new InMemoryJobStore()
		const hub = new ProgressHub()
		const failingSink: ObjectSink = {
			async putObject() { throw new Error('disk gone') },
		}
		const orchestrator = new IngestionOrchestrator()
		const final = await orchestrator.runJob(buildJob({ source: 'local', root: 'mem' }, 'job-allfail'), {
			connector: memConnector({ 'a.pdf': 'data' }),
			sink: failingSink,
			store,
			hub,
		})
		expect(final.status).toBe('failed')
		expect(final.failedFiles).toBe(1)
	})

	test('enqueue mode returns early with processing (no open-HTTP hazard)', async () => {
		const store = new InMemoryJobStore()
		const hub = new ProgressHub()
		const queued: Array<{ checksum: string; collection: string }> = []
		const orchestrator = new IngestionOrchestrator()
		const final = await orchestrator.runJob(
			buildJob({ source: 'local', root: 'mem', collection: 'contracts' }, 'job-enq'),
			{
				connector: memConnector({ 'a.pdf': 'content-a', 'b.pdf': 'content-b' }),
				sink: memSink,
				store,
				hub,
				enqueue: async (file) => {
					queued.push({ checksum: file.checksum, collection: file.collection })
				},
			},
		)
		expect(final.status).toBe('processing')
		expect(queued).toHaveLength(2)
		expect(new Set(queued.map((q) => q.collection))).toEqual(new Set(['contracts']))
		const kinds = hub.history('job-enq').map((e) => e.kind)
		expect(kinds[kinds.length - 1]).toBe('files-queued')
	})

	test('enqueuePendingFiles skips keyless and summarized rows (resume-safe)', async () => {
		const store = new InMemoryJobStore()
		await store.createJob({
			id: 'job-resume', source: 'local', root: 'mem', collection: 'judgments',
			status: 'processing', totalFiles: 3, doneFiles: 0, failedFiles: 0,
			totalBytes: 0, transferredBytes: 0,
			createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
			lastError: null,
		})
		const seed = [
			{ checksum: 'aaa', storageKey: 'judgments/local/job-resume/a-aaa.pdf', status: 'summarized' },
			{ checksum: 'bbb', storageKey: 'judgments/local/job-resume/b-bbb.pdf', status: 'uploaded' },
			{ checksum: 'ccc', storageKey: null, status: 'staged' },
		] as const
		for (const s of seed) {
			await store.upsertFile({
				id: `job-resume:${s.checksum}`, jobId: 'job-resume', collection: 'judgments',
				source: 'local', sourceKey: `mem://${s.checksum}.pdf`, relativePath: `${s.checksum}.pdf`,
				filename: `${s.checksum}.pdf`, sizeBytes: 5, checksum: s.checksum,
				storageKey: s.storageKey as string | null, status: s.status as 'summarized' | 'uploaded' | 'staged',
				attempts: 1, lastError: null, bytesTransferred: 5,
			})
		}
		const { enqueuePendingFiles } = await import('../src/jobs/orchestrator')
		const queued: string[] = []
		const result = await enqueuePendingFiles(store, 'job-resume', async (f) => {
			queued.push(f.checksum)
		})
		expect(result).toEqual({ enqueued: 1, failed: 0 })
		expect(queued).toEqual(['bbb'])
	})

	test('enqueue failure marks the file (not the job) as failed and continues', async () => {
		const store = new InMemoryJobStore()
		const hub = new ProgressHub()
		const orchestrator = new IngestionOrchestrator()
		const final = await orchestrator.runJob(
			buildJob({ source: 'local', root: 'mem', collection: 'judgments' }, 'job-enqfail'),
			{
				connector: memConnector({ 'a.pdf': 'content-a', 'b.pdf': 'content-b' }),
				sink: memSink,
				store,
				hub,
				enqueue: async (file) => {
					if (file.relativePath === 'a.pdf') throw new Error('Redis down')
				},
			},
		)
		// One bad enqueue must not abort the batch or the HTTP request.
		expect(final.status).toBe('processing')
		expect(final.failedFiles).toBe(1)
		const failed = await store.getFile('job-enqfail', (await store.listFiles('job-enqfail')).find((f) => f.relativePath === 'a.pdf')!.checksum)
		expect(failed?.status).toBe('failed')
		expect(failed?.lastError).toMatch(/enqueue failed: Redis down/)
		const kinds = hub.history('job-enqfail').map((e) => e.kind)
		expect(kinds).toContain('file-failed')
		expect(kinds[kinds.length - 1]).toBe('files-queued')
	})

	test('all enqueues failing fails the job with a clear error', async () => {
		const store = new InMemoryJobStore()
		const hub = new ProgressHub()
		const orchestrator = new IngestionOrchestrator()
		const final = await orchestrator.runJob(
			buildJob({ source: 'local', root: 'mem' }, 'job-enqallfail'),
			{
				connector: memConnector({ 'a.pdf': 'content-a' }),
				sink: memSink,
				store,
				hub,
				enqueue: async () => {
					throw new Error('Redis down')
				},
			},
		)
		expect(final.status).toBe('failed')
		expect(final.lastError).toMatch(/enqueue/)
	})

	test('empty discovery completes immediately (no stuck processing job)', async () => {
		const store = new InMemoryJobStore()
		const hub = new ProgressHub()
		const orchestrator = new IngestionOrchestrator()
		const final = await orchestrator.runJob(buildJob({ source: 'local', root: 'mem' }, 'job-empty'), {
			connector: memConnector({ 'notes.txt': 'skip me' }),
			sink: memSink,
			store,
			hub,
			enqueue: async () => {},
		})
		expect(final.status).toBe('done')
		expect(final.totalFiles).toBe(0)
	})

	test('rerun is idempotent: second run skips stored checksums', async () => {
		const store = new InMemoryJobStore()
		const hub = new ProgressHub()
		const orchestrator = new IngestionOrchestrator()
		const connector = memConnector({ 'a.pdf': 'same-bytes' })
		await orchestrator.runJob(buildJob({ source: 'local', root: 'mem' }, 'job-idem'), {
			connector, sink: memSink, store, hub,
		})
		let puts = 0
		const countingSink: ObjectSink = {
			async putObject(_o, body) { puts += 1; for await (const _c of body) { /* drain */ } },
		}
		// Second job id would normally differ; simulate resume by re-uploading into the SAME store/job via uploader path:
		// instead assert the store already holds the checksum so a fresh uploader run skips.
		const { uploadDiscoveredFiles } = await import('../src/transfer/uploader')
		const files: SourceFile[] = []
		for await (const f of connector.listFiles({ root: 'mem' })) files.push(f)
		const hub2 = new ProgressHub()
		const res = await uploadDiscoveredFiles(connector, files, {
			jobId: 'job-idem', source: 'local', collection: 'judgments', store, sink: countingSink, hub: hub2, storageBucket: 'judgments',
		})
		expect(res.skipped).toBe(1)
		expect(puts).toBe(0)
	})
})
