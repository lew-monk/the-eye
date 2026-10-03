export * from './ports/source-connector'
export * from './ports/object-sink'
export * from './ports/job-store'
export * from './connectors/local-fs'
export * from './connectors/s3'
export * from './connectors/gdrive'
export * from './connectors/registry'
export * from './walk/filters'
export * from './walk/walker'
export * from './transfer/policy'
export * from './transfer/uploader'
export * from './jobs/types'
export * from './jobs/orchestrator'
export * from './jobs/store-memory'
export * from './jobs/store-drizzle'
export * from './progress/hub'
export * from './pipeline/judgment-queue'
export * from './pipeline/judgment-worker'
export * from './pipeline/worker-events'
export * from './logging/logger'
export * from './pipeline/meta'
export * from './storage/keys'

import { randomUUID } from 'node:crypto'
import type { JobStore } from './ports/job-store'
import { normalizeCollection, type IngestionJob } from './jobs/types'
import type { ProgressHub } from './progress/hub'
import type { SourceConnector } from './ports/source-connector'
import type { ObjectSink } from './ports/object-sink'
import { IngestionOrchestrator, type PipelineHooks } from './jobs/orchestrator'
import type { JobEvent } from './jobs/types'

export type { SourceKind } from './ports/source-connector'

export interface CreateJobInput {
	source: string
	root: string
	/** Document collection. Defaults to 'judgments'. */
	collection?: string
}

export function newJobId(): string {
	return randomUUID()
}

export function buildJob(input: CreateJobInput, id = newJobId()): IngestionJob {
	const now = new Date().toISOString()
	return {
		id,
		source: input.source,
		root: input.root,
		collection: normalizeCollection(input.collection),
		status: 'pending',
		totalFiles: 0,
		doneFiles: 0,
		failedFiles: 0,
		totalBytes: 0,
		transferredBytes: 0,
		createdAt: now,
		updatedAt: now,
		lastError: null,
	}
}

export async function createJob(
	input: CreateJobInput,
	deps: {
		connector: SourceConnector
		sink: ObjectSink
		store: JobStore
		hub: ProgressHub
		hooks?: PipelineHooks
	},
): Promise<IngestionJob> {
	const job = buildJob(input)
	const orchestrator = new IngestionOrchestrator()
	// Run inline (v1); queue-backed execution is a drop-in via pipeline/judgment-queue.
	return orchestrator.runJob(job, deps)
}

export async function getStatus(store: JobStore, jobId: string): Promise<IngestionJob | null> {
	return store.getJob(jobId)
}

export async function listFiles(store: JobStore, jobId: string) {
	return store.listFiles(jobId)
}

export function streamEvents(hub: ProgressHub, jobId: string, listener: (e: JobEvent) => void) {
	return hub.subscribe(jobId, listener)
}
