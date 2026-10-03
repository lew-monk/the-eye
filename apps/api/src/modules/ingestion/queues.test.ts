import { describe, expect, test } from 'bun:test'
import { getQueuesStatus, type QueueAccessor } from './queues'

function fakeAccessor(seen: string[]): QueueAccessor {
	return {
		getCounts: async (collection) => {
			seen.push(collection)
			return { waiting: collection === 'judgments' ? 3 : 0, active: 1, completed: 5, failed: 0, delayed: 0 }
		},
	}
}

describe('ingestion queues — status reporting', () => {
	test('reports per-collection queues with counts', async () => {
		const seen: string[] = []
		const statuses = await getQueuesStatus(['judgments', 'contracts'], fakeAccessor(seen))
		expect(statuses).toHaveLength(2)
		expect(statuses[0]).toMatchObject({ collection: 'judgments', queue: 'judgments', counts: { waiting: 3, active: 1 } })
		expect(statuses[1]).toMatchObject({ collection: 'contracts', queue: 'ingest:contracts' })
		expect(seen).toEqual(['judgments', 'contracts'])
	})

	test('normalizes and dedupes collections (no double Redis reads)', async () => {
		const seen: string[] = []
		const statuses = await getQueuesStatus(['Judgments', 'judgments', '  '], fakeAccessor(seen))
		expect(statuses).toHaveLength(1)
		expect(seen).toEqual(['judgments'])
	})

	test('empty collections yields empty status (no Redis touched)', async () => {
		const seen: string[] = []
		expect(await getQueuesStatus([], fakeAccessor(seen))).toEqual([])
		expect(seen).toEqual([])
	})

	test('accessor failure propagates (route turns it into 500, never silent [])', async () => {
		const failing: QueueAccessor = {
			getCounts: async () => {
				throw new Error('Redis down')
			},
		}
		await expect(getQueuesStatus(['judgments'], failing)).rejects.toThrow(/Redis down/)
	})
})
