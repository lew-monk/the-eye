import { describe, expect, test } from 'bun:test'
import { streamJobEvents, type StreamDeps } from './worker-events'
import type { JobEvent, WorkerFileEvent } from '@workspace/ingestion'

function hubEvent(seq: number, kind: JobEvent['kind']): JobEvent {
	return { jobId: 'job-1', kind, seq, at: new Date(1000 + seq).toISOString() }
}

function fakeDeps(): StreamDeps & {
	emitHub(event: JobEvent): void
	emitWorker(event: WorkerFileEvent): void
} {
	const hubListeners = new Set<(event: JobEvent) => void>()
	const workerListeners = new Set<(event: WorkerFileEvent) => void>()
	return {
		history: () => [hubEvent(1, 'job-started'), hubEvent(2, 'files-queued')],
		files: async () => [{ checksum: 'abc', relativePath: 'a.pdf' }],
		collectWorker: async () => [
			{
				jobId: 'job-1',
				kind: 'file-done',
				checksum: 'abc',
				relativePath: 'a.pdf',
				stage: 'processed',
				at: new Date(3000).toISOString(),
			},
		],
		subscribeHub: (_jobId, listener) => {
			hubListeners.add(listener)
			return () => {
				hubListeners.delete(listener)
			}
		},
		subscribeWorker: async (_jobId, _collection, listener) => {
			workerListeners.add(listener)
			return () => {
				workerListeners.delete(listener)
			}
		},
		emitHub: (event) => {
			for (const listener of hubListeners) listener(event)
		},
		emitWorker: (event) => {
			for (const listener of workerListeners) listener(event)
		},
	}
}

class FrameReader {
	private reader: ReadableStreamDefaultReader<Uint8Array>
	private decoder = new TextDecoder()
	private buffer = ''

	constructor(response: Response) {
		const reader = response.body?.getReader()
		if (!reader) throw new Error('No response body')
		this.reader = reader
	}

	/** Read until `count` additional data frames arrive (or timeout). */
	async take(count: number, timeoutMs = 1500): Promise<Record<string, unknown>[]> {
		const frames: Record<string, unknown>[] = []
		const deadline = Date.now() + timeoutMs
		while (frames.length < count && Date.now() < deadline) {
			const { done, value } = await this.reader.read()
			if (done) break
			this.buffer += this.decoder.decode(value, { stream: true })
			const parts = this.buffer.split('\n\n')
			this.buffer = parts.pop() ?? ''
			for (const part of parts) {
				if (part.startsWith(':')) continue
				const line = part.split('\n').find((l) => l.startsWith('data:'))
				if (line) frames.push(JSON.parse(line.slice(5)) as Record<string, unknown>)
			}
		}
		return frames
	}

	async close(): Promise<void> {
		await this.reader.cancel().catch(() => {})
		this.reader.releaseLock()
	}
}

describe('ingestion SSE stream — merged live events', () => {
	test('initial snapshot merges hub + worker with continuous seq', async () => {
		const deps = fakeDeps()
		const controller = new AbortController()
		const response = await streamJobEvents('job-1', 'judgments', 0, controller.signal, deps)
		expect(response.headers.get('Content-Type')).toBe('text/event-stream')
		const reader = new FrameReader(response)
		const frames = await reader.take(3)
		await reader.close()
		controller.abort()
		expect(frames.map((f) => f.seq)).toEqual([1, 2, 3])
		expect(frames.map((f) => f.kind)).toEqual(['job-started', 'files-queued', 'file-done'])
		expect(frames[2]?.stage).toBe('processed')
	})

	test('after-cursor skips already-seen events', async () => {
		const deps = fakeDeps()
		const controller = new AbortController()
		const response = await streamJobEvents('job-1', 'judgments', 2, controller.signal, deps)
		const reader = new FrameReader(response)
		const frames = await reader.take(1)
		await reader.close()
		controller.abort()
		expect(frames.map((f) => f.seq)).toEqual([3])
	})

	test('live hub event is forwarded with rewritten seq (no cursor collision)', async () => {
		const deps = fakeDeps()
		const controller = new AbortController()
		const response = await streamJobEvents('job-1', 'judgments', 0, controller.signal, deps)
		const reader = new FrameReader(response)
		// Drain snapshot first (3 frames), then emit a live hub event with an old seq.
		await reader.take(3)
		deps.emitHub(hubEvent(3, 'file-failed'))
		const [live] = await reader.take(1)
		await reader.close()
		controller.abort()
		// Hub seq was 3 (collides with merged worker seq 3) → rewritten past cursor.
		expect(live?.seq).toBe(4)
	})

	test('live worker event is forwarded', async () => {
		const deps = fakeDeps()
		deps.collectWorker = async () => []
		const controller = new AbortController()
		const response = await streamJobEvents('job-1', 'judgments', 0, controller.signal, deps)
		const reader = new FrameReader(response)
		await reader.take(2)
		deps.emitWorker({
			jobId: 'job-1',
			kind: 'file-progress',
			checksum: 'abc',
			relativePath: 'a.pdf',
			stage: 'ocr',
			pct: 35,
			at: new Date(4000).toISOString(),
		})
		const [live] = await reader.take(1)
		await reader.close()
		controller.abort()
		expect(live?.kind).toBe('file-progress')
		expect(live?.pct).toBe(35)
	})

	test('abort ends the stream (no leaked subscription)', async () => {
		const deps = fakeDeps()
		let unsubscribed = 0
		const inner = deps.subscribeHub
		deps.subscribeHub = (jobId, listener) => {
			const off = inner(jobId, listener)
			return () => {
				unsubscribed += 1
				off()
			}
		}
		const controller = new AbortController()
		const response = await streamJobEvents('job-1', 'judgments', 0, controller.signal, deps)
		const reader = new FrameReader(response)
		await reader.take(1)
		await reader.close()
		controller.abort()
		await new Promise((resolve) => setTimeout(resolve, 50))
		expect(unsubscribed).toBe(1)
	})
})
