import { describe, expect, test } from 'bun:test'
import { DrizzleJobStore, type DrizzleJobDeps, type DrizzleFileDeps } from '../src/jobs/store-drizzle'
import { buildJob } from '../src/index'

function makeDeps() {
	const jobs = new Map<string, Record<string, unknown>>()
	const files = new Map<string, Record<string, unknown>>()
	const jobDeps: DrizzleJobDeps = {
		findById: async (id) => jobs.get(id) ?? null,
		list: async () => [...jobs.values()],
		create: async (row) => {
			jobs.set(String(row.id), { ...row })
			return row
		},
		update: async (id, patch) => {
			const existing = jobs.get(id)
			if (!existing) throw new Error(`Job not found: ${id}`)
			jobs.set(id, { ...existing, ...patch })
		},
	}
	const fileDeps: DrizzleFileDeps = {
		findByChecksum: async (checksum) => files.get(checksum) ?? null,
		create: async (row) => {
			files.set(String(row.checksum), { ...row })
			return row
		},
		update: async (checksum, patch) => {
			const existing = files.get(checksum)
			if (!existing) throw new Error(`File not found: ${checksum}`)
			files.set(checksum, { ...existing, ...patch })
		},
		listByJob: async (jobId) => [...files.values()].filter((f) => f.jobId === jobId),
	}
	return { jobs: jobDeps, files: fileDeps }
}

describe('jobs/store-drizzle — durable job + file mapping', () => {
	test('job round-trips with ISO dates and collection preserved', async () => {
		const store = new DrizzleJobStore(makeDeps())
		const job = buildJob({ source: 's3', root: 'bucket/prefix', collection: 'Contracts' }, 'job-1')
		await store.createJob(job)
		const loaded = await store.getJob('job-1')
		expect(loaded?.collection).toBe('contracts')
		expect(loaded?.status).toBe('pending')
		expect(typeof loaded?.createdAt).toBe('string')
		expect(new Date(loaded?.createdAt as string).getTime()).not.toBeNaN()
	})

	test('missing collection in row defaults to judgments (legacy rows)', async () => {
		const deps = makeDeps()
		const store = new DrizzleJobStore(deps)
		await deps.jobs.create({ id: 'legacy', source: 'local', root: '/x', status: 'done' })
		expect((await store.getJob('legacy'))?.collection).toBe('judgments')
	})

	test('updateJob patches counters without touching identity', async () => {
		const store = new DrizzleJobStore(makeDeps())
		await store.createJob(buildJob({ source: 'local', root: '/x' }, 'job-2'))
		await store.updateJob('job-2', { status: 'processing', totalFiles: 3 })
		const loaded = await store.getJob('job-2')
		expect(loaded?.status).toBe('processing')
		expect(loaded?.totalFiles).toBe(3)
		expect(loaded?.id).toBe('job-2')
	})

	test('files upsert by checksum and carry collection', async () => {
		const store = new DrizzleJobStore(makeDeps())
		const file = {
			id: 'j:c1', jobId: 'j', collection: 'contracts', source: 's3',
			sourceKey: 's3://b/k', relativePath: 'a.pdf', filename: 'a.pdf',
			sizeBytes: 10, checksum: 'c1', storageKey: null, status: 'staged' as const,
			attempts: 0, lastError: null, bytesTransferred: 0,
		}
		await store.upsertFile(file)
		await store.updateFile('j', 'c1', { status: 'uploaded', storageKey: 'contracts/s3/j/a-c1.pdf' })
		const loaded = await store.getFile('j', 'c1')
		expect(loaded?.status).toBe('uploaded')
		expect(loaded?.collection).toBe('contracts')
		expect(await store.listFiles('j')).toHaveLength(1)
		expect(await store.listFiles('other')).toHaveLength(0)
	})

	test('getJob returns null for unknown id (no throw on 404 path)', async () => {
		const store = new DrizzleJobStore(makeDeps())
		expect(await store.getJob('missing')).toBeNull()
	})

	test('concurrent duplicate upserts resolve to one first-wins row (checksum race)', async () => {
		const rows = new Map<string, Record<string, unknown>>()
		let findCalls = 0
		let createCalls = 0
		let upsertCalls = 0
		const deps = makeDeps()
		// Atomic upsert emulating ON CONFLICT DO NOTHING: check-and-set with
		// a yielded microtask in between, so interleaved callers converge.
		deps.files.upsert = async (row) => {
			upsertCalls += 1
			await Promise.resolve()
			const key = String(row.checksum)
			const winner = rows.get(key)
			if (winner) return winner
			rows.set(key, { ...row })
			return row
		}
		deps.files.findByChecksum = async () => {
			findCalls += 1
			return null
		}
		deps.files.create = async () => {
			createCalls += 1
			throw new Error('must not fall back to create when upsert exists')
		}
		const store = new DrizzleJobStore(deps)
		const fileFor = (relativePath: string) => ({
			id: `j:${relativePath}`, jobId: 'j', collection: 'judgments', source: 'local',
			sourceKey: `mem://${relativePath}`, relativePath, filename: 'same.pdf',
			sizeBytes: 9, checksum: 'dup-checksum', storageKey: null, status: 'staged' as const,
			attempts: 0, lastError: null, bytesTransferred: 0,
		})
		// Same content ingested from two folders at once (uploader concurrency).
		await Promise.all([
			store.upsertFile(fileFor('folder-a/same.pdf')),
			store.upsertFile(fileFor('folder-b/same.pdf')),
		])
		expect(upsertCalls).toBe(2)
		expect(findCalls).toBe(0)
		expect(createCalls).toBe(0)
		expect(rows.size).toBe(1)
		expect(rows.get('dup-checksum')?.relativePath).toBe('folder-a/same.pdf')
	})
})
