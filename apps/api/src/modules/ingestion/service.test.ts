import { describe, expect, test, beforeEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { IngestionService } from './service'
import { InMemoryJobStore, ProgressHub, type EnqueueFile } from '@workspace/ingestion'

let enqueued: EnqueueFile[]

beforeEach(() => {
	enqueued = []
	IngestionService.resetForTests({ store: new InMemoryJobStore(), hub: new ProgressHub() })
})

function recordEnqueue() {
	return {
		enqueue: async (file: EnqueueFile) => {
			enqueued.push(file)
		},
	}
}

describe('IngestionService — validation + job lifecycle', () => {
	test('rejects unknown source kind (no silent misroute)', async () => {
		await expect(
			IngestionService.createJob({ source: 'gdrive', root: 'folder' } as never),
		).rejects.toThrow(/Unsupported source/)
	})

	test('rejects relative local root (catches cwd-dependent bug)', async () => {
		await expect(IngestionService.createJob({ source: 'local-fs', root: 'relative/path' })).rejects.toThrow(
			/absolute path/,
		)
	})

	test('rejects missing local directory with 400-class error', async () => {
		await expect(
			IngestionService.createJob({ source: 'local-fs', root: '/does/not/exist-xyz' }),
		).rejects.toThrow(/not a directory/)
	})

	test('omitted collection defaults to judgments', async () => {
		const root = await mkdtemp(join(tmpdir(), 'api-ingest-col-'))
		try {
			await writeFile(join(root, 'a.pdf'), 'pdf-bytes')
			const job = await IngestionService.createJob({ source: 'local-fs', root }, recordEnqueue())
			expect(job.collection).toBe('judgments')
			const files = await IngestionService.listFiles(job.id)
			expect(files.data[0]?.storageKey?.startsWith('judgments/')).toBe(true)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test('custom collection flows into job + storage keys', async () => {
		const root = await mkdtemp(join(tmpdir(), 'api-ingest-col2-'))
		try {
			await writeFile(join(root, 'a.pdf'), 'pdf-bytes')
			const job = await IngestionService.createJob(
				{ source: 'local-fs', root, collection: 'Contracts' },
				recordEnqueue(),
			)
			expect(job.collection).toBe('contracts')
			const files = await IngestionService.listFiles(job.id)
			expect(files.data[0]?.storageKey?.startsWith('contracts/')).toBe(true)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test('rejects unsafe collection (no key-escape via collection)', async () => {
		await expect(
			IngestionService.createJob({ source: 's3', root: 'bucket/prefix', collection: '../evil' }),
		).rejects.toThrow(/Invalid collection/)
	})

	test('creates a job from a real nested dir and indexes only supported files', async () => {
		const root = await mkdtemp(join(tmpdir(), 'api-ingest-'))
		try {
			await mkdir(join(root, 'sub'), { recursive: true })
			await writeFile(join(root, 'sub', 'a.pdf'), 'pdf-bytes')
			await writeFile(join(root, 'notes.txt'), 'skip me')
			const job = await IngestionService.createJob({ source: 'local-fs', root }, recordEnqueue())
			// Queue-backed: returns after upload+enqueue, worker finishes processing.
			expect(job.status).toBe('processing')
			expect(job.totalFiles).toBe(1)
			const files = await IngestionService.listFiles(job.id)
			expect(files.pagination.total).toBe(1)
			expect(files.data[0]?.relativePath).toBe('sub/a.pdf')
			const stored = await IngestionService.getJob(job.id)
			expect(stored?.id).toBe(job.id)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test('enqueues exactly one job per uploaded file with dedup payload', async () => {
		const root = await mkdtemp(join(tmpdir(), 'api-ingest-enq-'))
		try {
			await writeFile(join(root, 'a.pdf'), 'pdf-a')
			await writeFile(join(root, 'b.pdf'), 'pdf-b')
			const job = await IngestionService.createJob(
				{ source: 'local-fs', root, collection: 'contracts' },
				recordEnqueue(),
			)
			expect(enqueued).toHaveLength(2)
			for (const file of enqueued) {
				expect(file.jobId).toBe(job.id)
				expect(file.collection).toBe('contracts')
				expect(file.storageKey.startsWith('contracts/')).toBe(true)
				expect(file.checksum.length).toBeGreaterThanOrEqual(8)
			}
			const ids = new Set(enqueued.map((f) => `${f.jobId}_${f.checksum}`))
			expect(ids.size).toBe(2)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test('listFiles paginates (catches offset-ignored bug)', async () => {
		const root = await mkdtemp(join(tmpdir(), 'api-ingest-page-'))
		try {
			await writeFile(join(root, 'a.pdf'), 'a')
			await writeFile(join(root, 'b.pdf'), 'b')
			const job = await IngestionService.createJob({ source: 'local-fs', root }, recordEnqueue())
			const page1 = await IngestionService.listFiles(job.id, 1, 0)
			const page2 = await IngestionService.listFiles(job.id, 1, 1)
			expect(page1.data).toHaveLength(1)
			expect(page2.data).toHaveLength(1)
			expect(page1.data[0]?.checksum).not.toBe(page2.data[0]?.checksum)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test('events history exposes job-started → files-queued ordering', async () => {
		const root = await mkdtemp(join(tmpdir(), 'api-ingest-events-'))
		try {
			await writeFile(join(root, 'a.pdf'), 'a')
			const job = await IngestionService.createJob({ source: 'local-fs', root }, recordEnqueue())
			const events = IngestionService.getEvents(job.id)
			expect(events[0]?.kind).toBe('job-started')
			expect(events[events.length - 1]?.kind).toBe('files-queued')
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test('getJob returns null for unknown id (no throw on 404 path)', async () => {
		expect(await IngestionService.getJob('missing')).toBeNull()
	})

	test('enqueueJob re-drives stuck uploaded files without re-uploading', async () => {
		const root = await mkdtemp(join(tmpdir(), 'api-ingest-redrive-'))
		try {
			await writeFile(join(root, 'a.pdf'), 'pdf-a')
			await writeFile(join(root, 'b.pdf'), 'pdf-b')
			const job = await IngestionService.createJob({ source: 'local-fs', root }, recordEnqueue())
			expect(enqueued).toHaveLength(2)
			// Simulate the stuck state: files uploaded, worker never ran.
			enqueued.length = 0
			const result = await IngestionService.enqueueJob(job.id, recordEnqueue())
			expect(result).toEqual({ jobId: job.id, enqueued: 2, failed: 0 })
			expect(enqueued).toHaveLength(2)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test('enqueueJob skips summarized files (no duplicate worker jobs)', async () => {
		const root = await mkdtemp(join(tmpdir(), 'api-ingest-redrive2-'))
		try {
			await writeFile(join(root, 'a.pdf'), 'pdf-a')
			const job = await IngestionService.createJob({ source: 'local-fs', root }, recordEnqueue())
			const files = await IngestionService.listFiles(job.id)
			const checksum = files.data[0]?.checksum as string
			await IngestionService.store.updateFile(job.id, checksum, { status: 'summarized' })
			enqueued.length = 0
			const result = await IngestionService.enqueueJob(job.id, recordEnqueue())
			expect(result.enqueued).toBe(0)
			expect(enqueued).toHaveLength(0)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test('enqueueJob throws Job not found for unknown id (route maps to 404)', async () => {
		await expect(IngestionService.enqueueJob('missing')).rejects.toThrow(/Job not found/)
	})

	test('enqueueJob records per-file failures and still resolves counts', async () => {
		const root = await mkdtemp(join(tmpdir(), 'api-ingest-redrive3-'))
		try {
			await writeFile(join(root, 'a.pdf'), 'pdf-a')
			const job = await IngestionService.createJob({ source: 'local-fs', root }, recordEnqueue())
			const result = await IngestionService.enqueueJob(job.id, {
				enqueue: async () => {
					throw new Error('Redis down')
				},
			})
			expect(result).toEqual({ jobId: job.id, enqueued: 0, failed: 1 })
			const files = await IngestionService.listFiles(job.id)
			expect(files.data[0]?.status).toBe('failed')
			expect(files.data[0]?.lastError).toMatch(/enqueue failed: Redis down/)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})
