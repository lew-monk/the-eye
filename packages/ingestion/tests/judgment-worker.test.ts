import { describe, expect, test } from 'bun:test'
import { InMemoryJobStore } from '../src/jobs/store-memory'
import { ProgressHub } from '../src/progress/hub'
import { buildJob } from '../src/index'
import { consoleLogger, memoryLogger, silentLogger } from '../src/logging/logger'
import {
	finalizeJobAggregates,
	processJudgmentFile,
	type JudgmentWorkerDeps,
} from '../src/pipeline/judgment-worker'

function makeDeps(overrides: Partial<JudgmentWorkerDeps> = {}): {
	deps: JudgmentWorkerDeps
	calls: { summaries: string[]; chunks: number; judgmentUpdates: Array<Record<string, unknown>> }
	store: InMemoryJobStore
} {
	const store = new InMemoryJobStore()
	const calls = { summaries: [] as string[], chunks: 0, judgmentUpdates: [] as Array<Record<string, unknown>> }
	const judgments = new Map<number, Record<string, unknown>>()
	let nextId = 1
	const deps: JudgmentWorkerDeps = {
		store,
		sink: { getBytes: async () => new TextEncoder().encode('pdf-bytes') },
		ocr: { extractText: async () => 'The court held that the appeal is dismissed. Parties met on 1 June 2024.' },
		embed: { embed: async (texts) => ({ vectors: texts.map((_, i) => [i + 1, i + 2]), model: 'test-model', provider: 'test' }) },
		summarize: { summarize: async (prompt) => { calls.summaries.push(prompt); return 'Appeal dismissed.' }, model: 'test-summary' },
		docs: {
			upsertJudgment: async (row) => {
				const id = nextId++
				judgments.set(id, { ...row, id })
				return { id }
			},
			replaceChunks: async (_id, chunks) => {
				calls.chunks = chunks.length
			},
			updateJudgment: async (id, patch) => {
				calls.judgmentUpdates.push({ id, ...patch })
				judgments.set(id, { ...judgments.get(id), ...patch })
			},
		},
		hub: new ProgressHub(),
		...overrides,
	}
	return { deps, calls, store }
}

async function seedUploaded(store: InMemoryJobStore, jobId: string, checksums: string[]) {
	await store.createJob({ ...buildJob({ source: 'local', root: '/x' }, jobId), status: 'processing' })
	for (const checksum of checksums) {
		await store.upsertFile({
			id: `${jobId}:${checksum}`, jobId, collection: 'judgments', source: 'local',
			sourceKey: `mem://${checksum}.pdf`, relativePath: `${checksum}.pdf`, filename: `${checksum}.pdf`,
			sizeBytes: 9, checksum, storageKey: `judgments/local/${jobId}/${checksum}.pdf`,
			status: 'uploaded', attempts: 0, lastError: null, bytesTransferred: 9,
		})
	}
}

describe('pipeline/judgment-worker — file processing', () => {
	test('happy path persists judgment + chunks and finalizes job', async () => {
		const { deps, calls, store } = makeDeps()
		await seedUploaded(store, 'job-1', ['c1'])
		const outcome = await processJudgmentFile(
			{ jobId: 'job-1', checksum: 'c1', storageKey: 'judgments/local/job-1/c1.pdf', relativePath: 'a.pdf', collection: 'judgments' },
			deps,
		)
		expect(outcome.status).toBe('summarized')
		if (outcome.status !== 'summarized') throw new Error('unreachable')
		expect(outcome.chunks).toBeGreaterThan(0)
		expect(calls.chunks).toBe(outcome.chunks)
		expect(calls.summaries).toHaveLength(1)
		expect(calls.summaries[0]).toMatch(/Do not invent citations/)
		const file = await store.getFile('job-1', 'c1')
		expect(file?.status).toBe('summarized')
		expect((await store.getJob('job-1'))?.status).toBe('done')
		const updates = calls.judgmentUpdates.filter((u) => u.id === outcome.judgmentId)
		expect(updates[updates.length - 1]?.status).toBe('summarized')
	})

	test('stage hook fires downloaded → ocr → embedded in order (BullMQ progress feed)', async () => {
		const stages: Array<{ stage: string; pct: number }> = []
		const { deps, store } = makeDeps({
			onStage: (stage, pct) => {
				stages.push({ stage, pct })
			},
		})
		await seedUploaded(store, 'job-stage', ['c1'])
		await processJudgmentFile(
			{ jobId: 'job-stage', checksum: 'c1', storageKey: 'k', relativePath: 'a.pdf', collection: 'judgments' },
			deps,
		)
		expect(stages.map((s) => s.stage)).toEqual(['downloaded', 'ocr', 'embedded'])
		const pcts = stages.map((s) => s.pct)
		expect([...pcts].sort((a, b) => a - b)).toEqual(pcts)
	})

	test('summarized redelivery is skipped (idempotent worker)', async () => {		const { deps, store } = makeDeps({
			ocr: { extractText: async () => { throw new Error('must not be called') } },
		})
		await seedUploaded(store, 'job-2', ['c1'])
		await store.updateFile('job-2', 'c1', { status: 'summarized' })
		const outcome = await processJudgmentFile(
			{ jobId: 'job-2', checksum: 'c1', storageKey: 'k', relativePath: 'a.pdf', collection: 'judgments' },
			deps,
		)
		expect(outcome).toEqual({ status: 'skipped' })
	})

	test('missing file record throws (poison job → BullMQ retry, not silent drop)', async () => {
		const { deps } = makeDeps()
		await expect(
			processJudgmentFile(
				{ jobId: 'nope', checksum: 'nope', storageKey: 'k', relativePath: 'a.pdf', collection: 'judgments' },
				deps,
			),
		).rejects.toThrow(/File record missing/)
	})

	test('OCR failure marks file failed with lastError and rethrows for retry', async () => {
		const { deps, store } = makeDeps({ ocr: { extractText: async () => { throw new Error('azure down') } } })
		await seedUploaded(store, 'job-3', ['c1'])
		await expect(
			processJudgmentFile(
				{ jobId: 'job-3', checksum: 'c1', storageKey: 'k', relativePath: 'a.pdf', collection: 'judgments' },
				deps,
			),
		).rejects.toThrow(/azure down/)
		const file = await store.getFile('job-3', 'c1')
		expect(file?.status).toBe('failed')
		expect(file?.lastError).toMatch(/azure down/)
	})

	test('empty OCR text fails loudly instead of storing phantom empties', async () => {
		const { deps, store } = makeDeps({ ocr: { extractText: async () => '   ' } })
		await seedUploaded(store, 'job-4', ['c1'])
		await expect(
			processJudgmentFile(
				{ jobId: 'job-4', checksum: 'c1', storageKey: 'k', relativePath: 'a.pdf', collection: 'judgments' },
				deps,
			),
		).rejects.toThrow(/no text/)
	})

	test('vector/chunk count mismatch throws (catches provider truncation)', async () => {
		const longText = 'The court held that the appeal is dismissed. '.repeat(60)
		const { deps, store } = makeDeps({
			ocr: { extractText: async () => longText },
			embed: { embed: async () => ({ vectors: [[1]], model: 'm' }) },
		})
		await seedUploaded(store, 'job-5', ['c1'])
		await expect(
			processJudgmentFile(
				{ jobId: 'job-5', checksum: 'c1', storageKey: 'k', relativePath: 'a.pdf', collection: 'judgments' },
				deps,
			),
		).rejects.toThrow(/vectors for .* chunks/)
	})

	test('collection flows into the judgment row (no cross-collection write)', async () => {		const seen: string[] = []
		const { deps, store } = makeDeps({
			docs: {
				upsertJudgment: async (row) => {
					seen.push(row.collection)
					return { id: 7 }
				},
				replaceChunks: async () => {},
				updateJudgment: async () => {},
			},
		})
		await store.createJob({ ...buildJob({ source: 'local', root: '/x', collection: 'contracts' }, 'job-6'), status: 'processing' })
		await store.upsertFile({
			id: 'job-6:c1', jobId: 'job-6', collection: 'contracts', source: 'local',
			sourceKey: 'mem://c1.pdf', relativePath: 'c1.pdf', filename: 'c1.pdf',
			sizeBytes: 9, checksum: 'c1', storageKey: 'contracts/local/job-6/c1.pdf',
			status: 'uploaded', attempts: 0, lastError: null, bytesTransferred: 9,
		})
		await processJudgmentFile(
			{ jobId: 'job-6', checksum: 'c1', storageKey: 'contracts/local/job-6/c1.pdf', relativePath: 'c1.pdf', collection: 'contracts' },
			deps,
		)
		expect(seen).toEqual(['contracts'])
	})
})

describe('finalizeJobAggregates — job-level settlement', () => {
	test('partial when mixed, failed when all failed, untouched while work remains', async () => {
		const store = new InMemoryJobStore()
		await store.createJob({ ...buildJob({ source: 'local', root: '/x' }, 'job-f'), status: 'processing' })
		for (const [checksum, status] of [['a', 'summarized'], ['b', 'failed']] as const) {
			await store.upsertFile({
				id: `job-f:${checksum}`, jobId: 'job-f', collection: 'judgments', source: 'local',
				sourceKey: `mem://${checksum}`, relativePath: checksum, filename: checksum,
				sizeBytes: 1, checksum, storageKey: 'k', status,
				attempts: 1, lastError: null, bytesTransferred: 1,
			})
		}
		await finalizeJobAggregates(store, 'job-f')
		const job = await store.getJob('job-f')
		expect(job?.status).toBe('partial')
		expect(job?.doneFiles).toBe(1)
		expect(job?.failedFiles).toBe(1)
	})

	test('does not finalize while files are still in flight', async () => {
		const store = new InMemoryJobStore()
		await store.createJob({ ...buildJob({ source: 'local', root: '/x' }, 'job-g'), status: 'processing' })
		await store.upsertFile({
			id: 'job-g:a', jobId: 'job-g', collection: 'judgments', source: 'local',
			sourceKey: 'mem://a', relativePath: 'a', filename: 'a',
			sizeBytes: 1, checksum: 'a', storageKey: 'k', status: 'ocr',
			attempts: 1, lastError: null, bytesTransferred: 1,
		})
		await finalizeJobAggregates(store, 'job-g')
		expect((await store.getJob('job-g'))?.status).toBe('processing')
	})
})

describe('pipeline/judgment-worker — debug logging', () => {
	const SECRET_TEXT = 'The court held that claimant Alice Nomatter wins.'

	function loggedDeps() {
		const logger = memoryLogger()
		const { deps, store } = makeDeps({ logger })
		return { deps, store, logger }
	}

	test('happy path logs staged lifecycle with ids (no content)', async () => {
		const { deps, store, logger } = loggedDeps()
		await seedUploaded(store, 'job-log', ['c1'])
		await processJudgmentFile(
			{ jobId: 'job-log', checksum: 'c1', storageKey: 'k', relativePath: 'a.pdf', collection: 'judgments' },
			deps,
		)
		const messages = logger.entries.map((e) => e.message)
		for (const expected of ['file-started', 'file-downloaded', 'ocr-completed', 'embed-completed', 'judgment-upserted', 'summarize-completed', 'file-summarized']) {
			expect(messages).toContain(expected)
		}
		const started = logger.entries.find((e) => e.message === 'file-started')
		expect(started?.fields).toMatchObject({ jobId: 'job-log', checksum: 'c1', relativePath: 'a.pdf' })
		const embedded = logger.entries.find((e) => e.message === 'embed-completed')
		expect(embedded?.fields).toMatchObject({ model: 'test-model' })
		expect(typeof embedded?.fields?.ms).toBe('number')
	})

	test('failure logs error with file ref and rethrows for retry', async () => {
		const { deps, store, logger } = loggedDeps()
		deps.ocr = { extractText: async () => { throw new Error('azure down') } }
		await seedUploaded(store, 'job-logfail', ['c1'])
		await expect(
			processJudgmentFile(
				{ jobId: 'job-logfail', checksum: 'c1', storageKey: 'k', relativePath: 'a.pdf', collection: 'judgments' },
				deps,
			),
		).rejects.toThrow(/azure down/)
		const failed = logger.entries.find((e) => e.message === 'file-failed')
		expect(failed?.level).toBe('error')
		expect(failed?.fields).toMatchObject({ jobId: 'job-logfail', checksum: 'c1', error: '[ocr] azure down' })
	})

	test('errors carry their stage tag (download/ocr/embed/summarize/persist)', async () => {
		const cases = [
			{
				name: 'download',
				override: { sink: { getBytes: async (_key: string): Promise<Uint8Array> => { throw new Error('s3 gone') } } },
				tag: '[download]',
			},
			{
				name: 'embed',
				override: { embed: { embed: async (_texts: string[]) => { throw new Error('quota hit') } } },
				tag: '[embed]',
			},
			{
				name: 'summarize',
				override: { summarize: { summarize: async (_prompt: string) => { throw new Error('model 403') }, model: 'm' } },
				tag: '[summarize]',
			},
		] as const
		for (const { name, override, tag } of cases) {
			const { deps, store } = makeDeps(override)
			const jobId = `job-stage-${name}`
			await seedUploaded(store, jobId, ['c1'])
			const file = { jobId, checksum: 'c1', storageKey: 'k', relativePath: 'a.pdf', collection: 'judgments' }
			await expect(processJudgmentFile(file, deps)).rejects.toThrow(tag)
			const row = await store.getFile(jobId, 'c1')
			expect(row?.lastError?.startsWith(tag)).toBe(true)
		}
	})

	test('skipped and missing-record paths log at info/error without content', async () => {
		const { deps, store, logger } = loggedDeps()
		await seedUploaded(store, 'job-logskip', ['c1'])
		await store.updateFile('job-logskip', 'c1', { status: 'summarized' })
		const skipped = await processJudgmentFile(
			{ jobId: 'job-logskip', checksum: 'c1', storageKey: 'k', relativePath: 'a.pdf', collection: 'judgments' },
			deps,
		)
		expect(skipped.status).toBe('skipped')
		expect(logger.entries.some((e) => e.message === 'file-skipped-already-summarized')).toBe(true)
		await expect(
			processJudgmentFile(
				{ jobId: 'missing', checksum: 'nope', storageKey: 'k', relativePath: 'x.pdf', collection: 'judgments' },
				deps,
			),
		).rejects.toThrow()
		expect(logger.entries.some((e) => e.message === 'file-record-missing' && e.level === 'error')).toBe(true)
	})

	test('no log field ever contains document content', async () => {
		const logger = memoryLogger()
		const { deps, store } = makeDeps({ logger })
		deps.ocr = { extractText: async () => SECRET_TEXT }
		await seedUploaded(store, 'job-logsecret', ['c1'])
		await processJudgmentFile(
			{ jobId: 'job-logsecret', checksum: 'c1', storageKey: 'k', relativePath: 'a.pdf', collection: 'judgments' },
			deps,
		)
		const dumped = JSON.stringify(logger.entries)
		expect(dumped).not.toContain('Alice Nomatter')
		expect(dumped).not.toContain(SECRET_TEXT)
	})

	test('logger implementations: silent never throws, console scopes output', () => {
		const silent = silentLogger()
		expect(() => {
			silent.debug('x')
			silent.info('x', { a: 1 })
			silent.warn('x')
			silent.error('x', { e: 'y' })
		}).not.toThrow()
		const lines: string[] = []
		const origLog = console.log
		const origErr = console.error
		console.log = (line: string) => { lines.push(line) }
		console.error = (line: string) => { lines.push(line) }
		try {
			const log = consoleLogger('TEST-SCOPE')
			log.info('hello', { jobId: 'j1', n: 2 })
			log.error('boom', { error: 'x' })
		} finally {
			console.log = origLog
			console.error = origErr
		}
		expect(lines[0]).toContain('[TEST-SCOPE] hello')
		expect(lines[0]).toContain('jobId="j1"')
		expect(lines[1]).toContain('[TEST-SCOPE] boom')
	})
})
