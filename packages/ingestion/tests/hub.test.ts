import { describe, expect, test } from 'bun:test'
import { ProgressHub } from '../src/progress/hub'

describe('progress/hub — SSE ordering + isolation', () => {
	test('seq increases monotonically per job', () => {
		const hub = new ProgressHub()
		const a = hub.publish({ jobId: 'j1', kind: 'job-started' })
		const b = hub.publish({ jobId: 'j1', kind: 'file-discovered', relativePath: 'a.pdf' })
		expect(b.seq).toBe(a.seq + 1)
	})

	test('listeners only receive their own job (no cross-talk leak)', () => {
		const hub = new ProgressHub()
		const got: string[] = []
		hub.subscribe('j1', (e) => got.push(e.kind))
		hub.publish({ jobId: 'j2', kind: 'job-started' })
		hub.publish({ jobId: 'j1', kind: 'job-started' })
		expect(got).toEqual(['job-started'])
	})

	test('unsubscribe stops delivery', () => {
		const hub = new ProgressHub()
		let count = 0
		const off = hub.subscribe('j1', () => { count += 1 })
		hub.publish({ jobId: 'j1', kind: 'job-started' })
		off()
		hub.publish({ jobId: 'j1', kind: 'job-started' })
		expect(count).toBe(1)
	})

	test('history replays in order after a seq cursor (polling resume)', () => {
		const hub = new ProgressHub()
		hub.publish({ jobId: 'j1', kind: 'job-started' })
		hub.publish({ jobId: 'j1', kind: 'file-discovered', relativePath: 'a.pdf' })
		hub.publish({ jobId: 'j1', kind: 'job-done' })
		const tail = hub.history('j1', 1)
		expect(tail.map((e) => e.kind)).toEqual(['file-discovered', 'job-done'])
		expect(tail.map((e) => e.seq)).toEqual([2, 3])
	})
})
