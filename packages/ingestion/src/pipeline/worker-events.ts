import type { JobEvent, JobEventKind } from '../jobs/types'
import { judgmentJobPrefix, type JudgmentFileJob } from './judgment-queue'

/** Minimal structural view of a BullMQ job — anything with these fields works (real Job or fake). */
export interface BullJobSnapshot {
	id?: string | undefined
	data: JudgmentFileJob
	state: string
	/** BullMQ progress payload: { stage, pct }, a bare number, or unset. */
	progress: unknown
	finishedOn?: number | null | undefined
	timestamp?: number | undefined
	failedReason?: string | undefined
}

export interface WorkerFileEvent {
	jobId: string
	kind: Extract<JobEventKind, 'file-progress' | 'file-done' | 'file-failed'>
	checksum: string
	relativePath: string
	stage?: string
	pct?: number
	error?: string
	at: string
}

function parseProgress(progress: unknown): { stage: string; pct: number } | null {
	if (typeof progress === 'number' && Number.isFinite(progress)) {
		return { stage: 'processing', pct: Math.max(0, Math.min(100, progress)) }
	}
	if (typeof progress === 'object' && progress !== null) {
		const record = progress as Record<string, unknown>
		if (typeof record.stage === 'string' && typeof record.pct === 'number' && Number.isFinite(record.pct)) {
			return { stage: record.stage, pct: Math.max(0, Math.min(100, record.pct)) }
		}
	}
	return null
}

function eventTime(snapshot: BullJobSnapshot): string {
	const ms = snapshot.finishedOn ?? snapshot.timestamp ?? Date.now()
	return new Date(ms).toISOString()
}

/**
 * Map one BullMQ job snapshot to a worker file event (or null when there is
 * nothing worth emitting). Ownership check uses the `jobId:` prefix AND the
 * payload's jobId, so job 'abc' never claims jobs of job 'abc2'.
 */
export function mapBullJobSnapshot(jobId: string, snapshot: BullJobSnapshot): WorkerFileEvent | null {
	if (snapshot.data.jobId !== jobId) return null
	if (typeof snapshot.id === 'string' && !snapshot.id.startsWith(judgmentJobPrefix(jobId))) return null
	const base = {
		jobId,
		checksum: snapshot.data.checksum,
		relativePath: snapshot.data.relativePath,
		at: eventTime(snapshot),
	}
	switch (snapshot.state) {
		case 'completed':
			return { ...base, kind: 'file-done', stage: 'processed', pct: 100 }
		case 'failed':
			return { ...base, kind: 'file-failed', error: (snapshot.failedReason ?? 'Worker failed').slice(0, 500) }
		case 'active': {
			const progress = parseProgress(snapshot.progress)
			return {
				...base,
				kind: 'file-progress',
				stage: progress?.stage ?? 'processing',
				pct: progress?.pct ?? 0,
			}
		}
		default:
			// waiting / delayed / paused: covered by the aggregate files-queued event.
			return null
	}
}

/**
 * Merge in-process hub history (upload phase, authoritative seq) with
 * worker-derived events (processing phase). Worker events sort by (at,
 * checksum) and continue the seq after the hub max, so `after` cursors work
 * across the merged numbering and replay is deterministic.
 */
export function mergeJobEvents(hubEvents: JobEvent[], workerEvents: WorkerFileEvent[]): JobEvent[] {
	const sortedWorker = [...workerEvents].sort((a, b) =>
		a.at < b.at ? -1 : a.at > b.at ? 1 : a.checksum < b.checksum ? -1 : 1,
	)
	let seq = hubEvents.reduce((max, e) => Math.max(max, e.seq), 0)
	const merged: JobEvent[] = [...hubEvents]
	for (const event of sortedWorker) {
		seq += 1
		merged.push({
			jobId: event.jobId,
			kind: event.kind,
			seq,
			at: event.at,
			relativePath: event.relativePath,
			checksum: event.checksum,
			...(event.stage ? { stage: event.stage } : {}),
			...(event.pct !== undefined ? { pct: event.pct } : {}),
			...(event.error ? { error: event.error } : {}),
		})
	}
	return merged
}
