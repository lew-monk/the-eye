import { describe, expect, test } from 'bun:test'
import {
	mapBullJobSnapshot,
	mergeJobEvents,
	type BullJobSnapshot,
	type WorkerFileEvent,
} from '../src/pipeline/worker-events'
import type { JobEvent } from '../src/jobs/types'

function hubEvent(seq: number, kind: JobEvent['kind']): JobEvent {
	return { jobId: 'job-1', kind, seq, at: new Date(1000 + seq).toISOString(), relativePath: 'a.pdf' }
}

function snapshot(overrides: Partial<BullJobSnapshot> = {}): BullJobSnapshot {
	return {
		id: 'job-1_abc',
		data: { jobId: 'job-1', checksum: 'abc', storageKey: 'k', relativePath: 'a.pdf', collection: 'judgments' },
		state: 'active',
		progress: null,
		timestamp: 5000,
		...overrides,
	}
}

describe('pipeline/worker-events — BullMQ → event mapping', () => {
	test('completed maps to file-done with processed stage', () => {
		const event = mapBullJobSnapshot('job-1', snapshot({ state: 'completed', finishedOn: 9000 }))
		expect(event).toMatchObject({ kind: 'file-done', checksum: 'abc', stage: 'processed', pct: 100 })
	})

	test('failed maps to file-failed with truncated reason', () => {
		const event = mapBullJobSnapshot(
			'job-1',
			snapshot({ state: 'failed', failedReason: 'x'.repeat(600), finishedOn: 9000 }),
		)
		expect(event?.kind).toBe('file-failed')
		expect(event?.error?.length).toBeLessThanOrEqual(500)
	})

	test('failed without reason still emits (no silent drop)', () => {
		const event = mapBullJobSnapshot('job-1', snapshot({ state: 'failed', finishedOn: 9000 }))
		expect(event?.kind).toBe('file-failed')
		expect(event?.error).toBe('Worker failed')
	})

	test('active with {stage,pct} progress maps through', () => {
		const event = mapBullJobSnapshot('job-1', snapshot({ progress: { stage: 'ocr', pct: 35 } }))
		expect(event).toMatchObject({ kind: 'file-progress', stage: 'ocr', pct: 35 })
	})

	test('active with bare-number progress maps with generic stage', () => {
		const event = mapBullJobSnapshot('job-1', snapshot({ progress: 50 }))
		expect(event).toMatchObject({ kind: 'file-progress', pct: 50 })
	})

	test('active without progress still emits (file visibly in-flight)', () => {
		expect(mapBullJobSnapshot('job-1', snapshot())?.kind).toBe('file-progress')
	})

	test('waiting/delayed emit nothing (covered by files-queued aggregate)', () => {
		expect(mapBullJobSnapshot('job-1', snapshot({ state: 'waiting' }))).toBeNull()
		expect(mapBullJobSnapshot('job-1', snapshot({ state: 'delayed' }))).toBeNull()
	})

	test('foreign payload jobId never claimed (abc vs abc2 prefix collision)', () => {
		const foreign = snapshot({
			id: 'job-12_zzz',
			data: { jobId: 'job-12', checksum: 'zzz', storageKey: 'k', relativePath: 'z.pdf', collection: 'judgments' },
			state: 'completed',
		})
		expect(mapBullJobSnapshot('job-1', foreign)).toBeNull()
	})

	test('mismatched bull id prefix rejected even with matching payload', () => {
		const sneaky = snapshot({ id: 'other_abc', state: 'completed' })
		expect(mapBullJobSnapshot('job-1', sneaky)).toBeNull()
	})
})

describe('mergeJobEvents — hub + worker ordering', () => {
	const worker = (checksum: string, at: string): WorkerFileEvent => ({
		jobId: 'job-1',
		kind: 'file-done',
		checksum,
		relativePath: `${checksum}.pdf`,
		stage: 'processed',
		at,
	})

	test('worker events continue seq after hub max, sorted by (at, checksum)', () => {
		const merged = mergeJobEvents(
			[hubEvent(1, 'job-started'), hubEvent(2, 'files-queued')],
			[worker('b', new Date(3000).toISOString()), worker('a', new Date(2000).toISOString()), worker('c', new Date(2000).toISOString())],
		)
		expect(merged.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
		expect(merged.slice(2).map((e) => e.checksum)).toEqual(['a', 'c', 'b'])
	})

	test('empty hub starts worker seq at 1 (fresh consumer)', () => {
		const merged = mergeJobEvents([], [worker('a', new Date(1000).toISOString())])
		expect(merged[0]?.seq).toBe(1)
	})

	test('empty worker list returns hub untouched (same refs, no renumber)', () => {
		const hub = [hubEvent(1, 'job-started')]
		const merged = mergeJobEvents(hub, [])
		expect(merged).toHaveLength(1)
		expect(merged[0]?.seq).toBe(1)
	})

	test('after-cursor slices across the merged numbering', () => {
		const merged = mergeJobEvents([hubEvent(1, 'job-started')], [worker('a', new Date(2000).toISOString())])
		expect(merged.filter((e) => e.seq > 1).map((e) => e.kind)).toEqual(['file-done'])
	})
})
