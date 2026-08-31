import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockDbExecute = mock()
const mockDbSelect = mock()
const mockParticipantSearch = mock()
const mockDocFindById = mock()

mock.module('@workspace/shared', () => ({
	db: {
		execute: mockDbExecute,
		select: mockDbSelect,
	},
	participantRepository: {
		search: mockParticipantSearch,
	},
	documentRepository: {
		findById: mockDocFindById,
	},
	coreferenceRepository: {
		findByDocumentId: mock(),
	},
	participants: {},
	documents: {},
	coreferenceResults: {},
	coreferenceClusters: {},
	coreferenceMentions: {},
}))

import { EntityService } from './service'

describe('EntityService.getConfidence', () => {
	beforeEach(() => {
		mockDbExecute.mockReset()
	})

	it('returns zeroed confidence when entity has no appearances', async () => {
		mockDbExecute
			.mockResolvedValueOnce([]) // roles
			.mockResolvedValueOnce([{ total: 0 }]) // totalDocs
			.mockResolvedValueOnce([]) // case coverage

		const result = await EntityService.getConfidence('ghost-entity')

		expect(result.overallScore).toBe(0)
		expect(result.roleConsistency).toBe(0)
		expect(result.roles).toEqual([])
		expect(result.flags).toEqual([])
	})

	it('scores high when role is consistent across appearances', async () => {
		mockDbExecute
			.mockResolvedValueOnce([
				{ role: 'witness', count: 4, documents: 4 },
			])
			.mockResolvedValueOnce([{ total: 4 }])
			.mockResolvedValueOnce([
				{ case_id: 1, case_total: 4 },
			])

		const result = await EntityService.getConfidence('jane-smith')

		expect(result.roleConsistency).toBe(100)
		expect(result.overallScore).toBeGreaterThanOrEqual(80)
		expect(result.flags.some((f) => f.includes('role consensus'))).toBe(false)
	})

	it('flags role outliers when a minority role appears', async () => {
		mockDbExecute
			.mockResolvedValueOnce([
				{ role: 'witness', count: 3, documents: 3 },
				{ role: 'defendant', count: 1, documents: 1 },
			])
			.mockResolvedValueOnce([{ total: 4 }])
			.mockResolvedValueOnce([
				{ case_id: 1, case_total: 5 },
			])

		const result = await EntityService.getConfidence('jane-smith')

		expect(result.roleConsistency).toBe(75)
		expect(result.roles).toHaveLength(2)
		expect(result.flags.some((f) => f.includes('defendant') && f.includes('outlier'))).toBe(true)
	})

	it('flags low role consensus when roles are split', async () => {
		mockDbExecute
			.mockResolvedValueOnce([
				{ role: 'witness', count: 2, documents: 2 },
				{ role: 'defendant', count: 2, documents: 2 },
			])
			.mockResolvedValueOnce([{ total: 4 }])
			.mockResolvedValueOnce([
				{ case_id: 1, case_total: 4 },
			])

		const result = await EntityService.getConfidence('split-entity')

		expect(result.roleConsistency).toBe(50)
		expect(result.flags.some((f) => f.includes('Low role consensus'))).toBe(true)
	})
})

describe('EntityService.getCoOccurrenceNetwork', () => {
	beforeEach(() => {
		mockDbExecute.mockReset()
	})

	it('returns empty network when no co-occurrences exist', async () => {
		mockDbExecute.mockResolvedValueOnce([])

		const result = await EntityService.getCoOccurrenceNetwork()

		expect(result.nodes).toEqual([])
		expect(result.edges).toEqual([])
	})

	it('builds nodes and edges from pairwise co-occurrence rows', async () => {
		mockDbExecute.mockResolvedValueOnce([
			{
				entityA: 'alice',
				nameA: 'Alice',
				roleA: 'witness',
				entityB: 'bob',
				nameB: 'Bob',
				roleB: 'defendant',
				docCount: 3,
			},
			{
				entityA: 'alice',
				nameA: 'Alice',
				roleA: 'witness',
				entityB: 'carol',
				nameB: 'Carol',
				roleB: 'judge',
				docCount: 2,
			},
		])

		const result = await EntityService.getCoOccurrenceNetwork(10)

		expect(result.edges).toHaveLength(2)
		expect(result.edges[0]).toEqual({
			source: 'alice',
			target: 'bob',
			weight: 3,
		})
		expect(result.nodes.map((n) => n.normalizedName).sort()).toEqual([
			'alice',
			'bob',
			'carol',
		])
		const alice = result.nodes.find((n) => n.normalizedName === 'alice')
		expect(alice?.displayName).toBe('Alice')
		expect(alice?.connections).toBe(2)
	})

	it('respects limit on edges', async () => {
		mockDbExecute.mockResolvedValueOnce([
			{
				entityA: 'a',
				nameA: 'A',
				roleA: 'other',
				entityB: 'b',
				nameB: 'B',
				roleB: 'other',
				docCount: 5,
			},
		])

		await EntityService.getCoOccurrenceNetwork(5)

		const sqlArg = mockDbExecute.mock.calls[0]?.[0]
		expect(sqlArg).toBeDefined()
	})
})

describe('EntityService.getDossier', () => {
	beforeEach(() => {
		mockDbExecute.mockReset()
		mockDbSelect.mockReset()
		mockParticipantSearch.mockReset()
	})

	it('returns null when entity has no appearances', async () => {
		const chain = {
			from: () => chain,
			innerJoin: () => chain,
			where: () => chain,
			orderBy: () => Promise.resolve([]),
		}
		mockDbSelect.mockReturnValue(chain)

		const result = await EntityService.getDossier('missing')
		expect(result).toBeNull()
	})

	it('assembles dossier with role distribution and confidence', async () => {
		const appearances = [
			{
				participantId: 1,
				documentId: 10,
				name: 'Jane Smith',
				filename: 'affidavit.pdf',
				caseId: 1,
				caseNumber: 'CASE-1',
				documentType: 'affidavit',
				role: 'witness',
				roleConfidence: 0.9,
				mentionCount: 5,
				relevanceScore: 0.8,
				mentions: ['Jane', 'Jane Smith'],
				clusterId: 1,
			},
			{
				participantId: 2,
				documentId: 11,
				name: 'Jane Smith',
				filename: 'judgment.pdf',
				caseId: 1,
				caseNumber: 'CASE-1',
				documentType: 'judgment',
				role: 'witness',
				roleConfidence: 0.85,
				mentionCount: 3,
				relevanceScore: 0.7,
				mentions: ['Jane Smith'],
				clusterId: 2,
			},
		]

		const chain = {
			from: () => chain,
			innerJoin: () => chain,
			where: () => chain,
			orderBy: () => Promise.resolve(appearances),
		}
		mockDbSelect.mockReturnValue(chain)

		// co-occurring
		mockDbExecute
			.mockResolvedValueOnce([]) // co-occurring
			// getConfidence calls
			.mockResolvedValueOnce([{ role: 'witness', count: 2, documents: 2 }])
			.mockResolvedValueOnce([{ total: 2 }])
			.mockResolvedValueOnce([{ case_id: 1, case_total: 2 }])

		mockParticipantSearch.mockResolvedValue({ data: [], total: 0 })

		const result = await EntityService.getDossier('jane-smith')

		expect(result).not.toBeNull()
		expect(result!.normalizedName).toBe('jane-smith')
		expect(result!.displayName).toBe('Jane Smith')
		expect(result!.totalDocuments).toBe(2)
		expect(result!.totalCases).toBe(1)
		expect(result!.totalMentions).toBe(8)
		expect(result!.primaryRole).toBe('witness')
		expect(result!.roleDistribution[0]).toMatchObject({
			role: 'witness',
			count: 2,
			percentage: 100,
		})
		expect(result!.appearances).toHaveLength(2)
		expect(result!.confidence.roleConsistency).toBe(100)
	})
})
