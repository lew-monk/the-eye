import type { JobEvent } from '../jobs/types'

/**
 * Typed in-memory event hub — the SSE source. Keeps a per-job append-only
 * log with monotonically increasing seq so polling + SSE see the same order.
 */
export class ProgressHub {
	private seqByJob = new Map<string, number>()
	private logByJob = new Map<string, JobEvent[]>()
	private listenersByJob = new Map<string, Set<(event: JobEvent) => void>>()

	publish(input: Omit<JobEvent, 'seq' | 'at'> & { at?: string }): JobEvent {
		const next = (this.seqByJob.get(input.jobId) ?? 0) + 1
		this.seqByJob.set(input.jobId, next)
		const event: JobEvent = {
			...input,
			seq: next,
			at: input.at ?? new Date().toISOString(),
		}
		const log = this.logByJob.get(input.jobId) ?? []
		log.push(event)
		this.logByJob.set(input.jobId, log)
		for (const listener of this.listenersByJob.get(input.jobId) ?? []) {
			listener(event)
		}
		return event
	}

	subscribe(jobId: string, listener: (event: JobEvent) => void): () => void {
		let set = this.listenersByJob.get(jobId)
		if (!set) {
			set = new Set()
			this.listenersByJob.set(jobId, set)
		}
		set.add(listener)
		return () => {
			set?.delete(listener)
		}
	}

	history(jobId: string, afterSeq = 0): JobEvent[] {
		return (this.logByJob.get(jobId) ?? []).filter((e) => e.seq > afterSeq)
	}

	clear(jobId: string): void {
		this.logByJob.delete(jobId)
		this.seqByJob.delete(jobId)
	}
}
