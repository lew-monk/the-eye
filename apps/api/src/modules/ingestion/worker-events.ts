import { QueueEvents } from 'bullmq'
import { redisConnectionOptions } from '@workspace/shared'
import {
	mapBullJobSnapshot,
	mergeJobEvents,
	queueNameForCollection,
	type BullJobSnapshot,
	type JobEvent,
	type WorkerFileEvent,
} from '@workspace/ingestion'
import { getIngestionQueue, IngestionService } from './service'

export interface FileChecksum {
	checksum: string
}

/** Get BullMQ state for each file. Map each state to a worker event. */
export async function collectWorkerEvents(
	jobId: string,
	collection: string,
	files: FileChecksum[],
): Promise<WorkerFileEvent[]> {
	const queue = getIngestionQueue(collection)
	const events: WorkerFileEvent[] = []
	for (const file of files) {
		const bullJob = await queue.getJob(`${jobId}:${file.checksum}`)
		if (!bullJob) continue
		const snapshot: BullJobSnapshot = {
			id: bullJob.id,
			data: bullJob.data,
			state: await bullJob.getState(),
			progress: bullJob.progress,
			finishedOn: bullJob.finishedOn ?? undefined,
			timestamp: bullJob.timestamp,
			failedReason: bullJob.failedReason ?? undefined,
		}
		const event = mapBullJobSnapshot(jobId, snapshot)
		if (event) events.push(event)
	}
	return events
}

/** Combine hub history (upload phase) with worker states (process phase). */
export async function mergedJobEvents(
	jobId: string,
	collection: string,
	hubHistory: JobEvent[],
	files: FileChecksum[],
): Promise<JobEvent[]> {
	return mergeJobEvents(hubHistory, await collectWorkerEvents(jobId, collection, files))
}

const HEARTBEAT_MS = 15_000
const MAX_STREAM_FILES = 1000

function sseFrame(payload: unknown): Uint8Array {
	return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
}

export interface StreamFileRef {
	checksum: string
	relativePath: string
}

export interface StreamDeps {
	history(jobId: string): JobEvent[]
	files(jobId: string): Promise<StreamFileRef[]>
	collectWorker(jobId: string, collection: string, files: StreamFileRef[]): Promise<WorkerFileEvent[]>
	subscribeHub(jobId: string, listener: (event: JobEvent) => void): () => void
	subscribeWorker(
		jobId: string,
		collection: string,
		listener: (event: WorkerFileEvent) => void,
	): Promise<() => void>
}

async function defaultSubscribeWorker(
	jobId: string,
	collection: string,
	listener: (event: WorkerFileEvent) => void,
): Promise<() => void> {
	const queue = getIngestionQueue(collection)
	const queueEvents = new QueueEvents(queueNameForCollection(collection), {
		connection: redisConnectionOptions(),
	})
	await queueEvents.waitUntilReady()
	const prefix = `${jobId}:`
	const onBullEvent = async ({ jobId: bullId }: { jobId: string }): Promise<void> => {
		if (!bullId.startsWith(prefix)) return
		try {
			const bullJob = await queue.getJob(bullId)
			if (!bullJob) return
			const event = mapBullJobSnapshot(jobId, {
				id: bullJob.id,
				data: bullJob.data,
				state: await bullJob.getState(),
				progress: bullJob.progress,
				finishedOn: bullJob.finishedOn ?? undefined,
				timestamp: bullJob.timestamp,
				failedReason: bullJob.failedReason ?? undefined,
			})
			if (event) listener(event)
		} catch {
			// Ignore short Redis errors. The next event or reconnect continues from ?after=.
		}
	}
	const progress = (args: unknown): void => {
		void onBullEvent(args as { jobId: string })
	}
	queueEvents.on('progress', progress)
	queueEvents.on('completed', progress)
	queueEvents.on('failed', progress)
	return async () => {
		queueEvents.off('progress', progress)
		queueEvents.off('completed', progress)
		queueEvents.off('failed', progress)
		await queueEvents.close().catch(() => {})
	}
}

function defaultStreamDeps(): StreamDeps {
	return {
		history: (jobId) => IngestionService.getEvents(jobId),
		files: async (jobId) => (await IngestionService.listFiles(jobId, MAX_STREAM_FILES, 0)).data,
		collectWorker: (jobId, collection, files) => collectWorkerEvents(jobId, collection, files),
		subscribeHub: (jobId, listener) => IngestionService.hub.subscribe(jobId, listener),
		subscribeWorker: defaultSubscribeWorker,
	}
}

/**
 * Stream live events for one ingestion job over SSE.
 * Send a merged snapshot first. The snapshot holds hub history and worker states.
 * Then send live hub events. Then send live worker progress and completion events.
 * Send heartbeats to keep the connection open.
 *
 * Live events share one sequence counter. The server rewrites the counter on send.
 * The `after` cursor thus never skips events. The stream ends on client disconnect.
 */
export async function streamJobEvents(
	jobId: string,
	collection: string,
	after: number,
	signal: AbortSignal,
	deps: StreamDeps = defaultStreamDeps(),
): Promise<Response> {
	let cursor = after
	let liveSeq = 0
	let closed = false
	let heartbeat: ReturnType<typeof setInterval> | undefined
	let hubUnsub: (() => void) | undefined
	let unsubWorker: (() => void) | undefined

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (event: JobEvent): void => {
				if (closed) return
				liveSeq = Math.max(liveSeq, event.seq) + 1
				cursor = liveSeq
				try {
					controller.enqueue(sseFrame({ ...event, seq: liveSeq }))
				} catch {
					void cleanup()
				}
			}

		const cleanup = async (): Promise<void> => {
			if (closed) return
			closed = true
			if (heartbeat) clearInterval(heartbeat)
			hubUnsub?.()
			await unsubWorker?.()
			try {
				controller.close()
			} catch {
				// already closed
			}
		}

			signal.addEventListener('abort', () => void cleanup(), { once: true })

			try {
				const history = deps.history(jobId)
				const files = await deps.files(jobId)
				const merged = mergeJobEvents(history, await deps.collectWorker(jobId, collection, files))
				liveSeq = merged.reduce((max, e) => Math.max(max, e.seq), 0)
				let hubCursor = history.reduce((max, e) => Math.max(max, e.seq), after)
				for (const event of merged) {
					if (event.seq > cursor) {
						cursor = event.seq
						controller.enqueue(sseFrame(event))
					}
				}

				// Hub and worker use separate counters.
				// Worker numbers continue past the hub maximum.
				// Thus a new hub event is not a duplicate.
				hubUnsub = deps.subscribeHub(jobId, (event) => {
					if (event.seq > hubCursor) {
						hubCursor = event.seq
						send(event)
					}
				})

				unsubWorker = await deps.subscribeWorker(jobId, collection, (event) => {
					liveSeq += 1
					cursor = liveSeq
					try {
						controller.enqueue(
							sseFrame({
								jobId: event.jobId,
								kind: event.kind,
								seq: liveSeq,
								at: event.at,
								relativePath: event.relativePath,
								checksum: event.checksum,
								...(event.stage ? { stage: event.stage } : {}),
								...(event.pct !== undefined ? { pct: event.pct } : {}),
								...(event.error ? { error: event.error } : {}),
							}),
						)
					} catch {
						void cleanup()
					}
				})

				heartbeat = setInterval(() => {
					if (closed) return
					try {
						controller.enqueue(new TextEncoder().encode(': ping\n\n'))
					} catch {
						void cleanup()
					}
				}, HEARTBEAT_MS)
			} catch {
				void cleanup()
			}
		},
		cancel() {
			closed = true
			if (heartbeat) clearInterval(heartbeat)
			hubUnsub?.()
			void unsubWorker?.()
		},
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
		},
	})
}
