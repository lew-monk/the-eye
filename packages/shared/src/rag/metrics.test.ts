import { describe, expect, it } from 'bun:test'
import { aggregateRetrieval, mrr, ndcgAtK, precisionAtK, recallAtK } from './metrics'

const gold = ['10:0', '10:2']

describe('retrieval metrics', () => {
	it('recall@k is 1 when every gold chunk is in the top-k', () => {
		expect(recallAtK(gold, ['10:0', '9:0', '10:2'], 3)).toBe(1)
		expect(recallAtK(gold, ['10:0', '9:0'], 2)).toBe(0.5)
	})

	it('precision@k counts only retrieved hits', () => {
		expect(precisionAtK(gold, ['10:0', 'x:1', '10:2', 'y:0'], 4)).toBe(0.5)
	})

	it('MRR uses the first gold rank', () => {
		expect(mrr(gold, ['nope', '10:2'])).toBe(0.5)
		expect(mrr(gold, ['nope', 'nope'])).toBe(0)
	})

	it('nDCG@k is 1 when gold fills the top ranks', () => {
		expect(ndcgAtK(gold, ['10:0', '10:2', 'x'], 2)).toBeCloseTo(1, 5)
		expect(ndcgAtK(gold, ['x', '10:0'], 2)).toBeLessThan(1)
	})

	it('aggregates a tiny gold set the way CI will', () => {
		const summary = aggregateRetrieval(
			[
				{ queryId: 'q1', goldChunkIds: ['1:0'], retrievedChunkIds: ['1:0', '2:0'] },
				{ queryId: 'q2', goldChunkIds: ['3:1'], retrievedChunkIds: ['9:0', '3:1'] },
			],
			5,
		)
		expect(summary.n).toBe(2)
		expect(summary.recallAtK).toBe(1)
		expect(summary.mrr).toBeCloseTo(0.75, 5)
	})
})
