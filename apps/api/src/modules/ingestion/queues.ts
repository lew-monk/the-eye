import { queueNameForCollection } from '@workspace/ingestion'
import { getIngestionQueue } from './service'

export interface QueueCounts {
	waiting: number
	active: number
	completed: number
	failed: number
	delayed: number
}

export interface QueueStatus {
	collection: string
	queue: string
	counts: QueueCounts
}

export interface QueueAccessor {
	getCounts(collection: string): Promise<QueueCounts>
}

function defaultAccessor(): QueueAccessor {
	return {
		getCounts: async (collection) => {
			const queue = getIngestionQueue(collection)
			const counts = await queue.getJobCounts(
				'waiting',
				'active',
				'completed',
				'failed',
				'delayed',
			)
			return {
				waiting: counts.waiting ?? 0,
				active: counts.active ?? 0,
				completed: counts.completed ?? 0,
				failed: counts.failed ?? 0,
				delayed: counts.delayed ?? 0,
			}
		},
	}
}

/**
 * Per-queue depth for the given collections. Answers "are files reaching
 * the queue, and is anything consuming them": waiting>0 with active=0
 * across polls means the worker is down or mis-subscribed.
 */
export async function getQueuesStatus(
	collections: readonly string[],
	accessor: QueueAccessor = defaultAccessor(),
): Promise<QueueStatus[]> {
	const normalized = [...new Set(collections.map((c) => c.trim().toLowerCase()).filter(Boolean))]
	const statuses: QueueStatus[] = []
	for (const collection of normalized) {
		statuses.push({
			collection,
			queue: queueNameForCollection(collection),
			counts: await accessor.getCounts(collection),
		})
	}
	return statuses
}
