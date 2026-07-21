import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockDocFindById = mock()
const mockDocFindByCaseId = mock()
const mockChunkFindByDocumentId = mock()
const mockParticipantFindById = mock()
const mockCorefFindByDocumentId = mock()

const mockDb = {
	select: () => ({
		from: () => ({
			innerJoin: () => ({
				innerJoin: () => ({
					innerJoin: () => ({
						innerJoin: () => ({
							where: () => ({
								orderBy: () => ({
									limit: (n: number) => ({ offset: () => Promise.resolve([]) }),
								}),
							}),
						}),
					}),
				}),
			}),
		}),
	}),
}

mock.module('@workspace/shared', () => ({
	documentRepository: {
		findById: mockDocFindById,
		findByCaseId: mockDocFindByCaseId,
	},
	chunkRepository: {
		findByDocumentId: mockChunkFindByDocumentId,
	},
	participantRepository: {
		findById: mockParticipantFindById,
	},
	coreferenceRepository: {
		findByDocumentId: mockCorefFindByDocumentId,
	},
	db: mockDb,
	participants: {},
	documents: {},
	coreferenceResults: {},
	coreferenceClusters: {},
	coreferenceMentions: {},
}))

import { CasesService } from './service'

describe('CasesService.getCaseChunks', () => {
	beforeEach(() => {
		mockDocFindByCaseId.mockReset()
		mockChunkFindByDocumentId.mockReset()
	})

	it('returns sorted chunks from all case documents', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{ id: 1, filename: 'doc1.pdf' },
			{ id: 2, filename: 'doc2.pdf' },
		])
		mockChunkFindByDocumentId.mockImplementation((docId: number) => {
			if (docId === 1) return [
				{ id: 10, documentId: 1, chunkIndex: 0, text: 'chunk1', positionWeight: 0.5, embedding: null },
				{ id: 11, documentId: 1, chunkIndex: 1, text: 'chunk2', positionWeight: 0.8, embedding: null },
			]
			return [
				{ id: 20, documentId: 2, chunkIndex: 0, text: 'chunk3', positionWeight: 0.3, embedding: null },
			]
		})

		const result = await CasesService.getCaseChunks(5)

		expect(result.length).toBe(3)
		expect(result[0].positionWeight).toBe(0.8)
		expect(result[1].positionWeight).toBe(0.5)
		expect(result[2].positionWeight).toBe(0.3)
		expect(result[0].filename).toBe('doc1.pdf')
		expect(result[2].filename).toBe('doc2.pdf')
	})

	it('filters out chunks with null positionWeight or text', async () => {
		mockDocFindByCaseId.mockResolvedValue([{ id: 1, filename: 'doc.pdf' }])
		mockChunkFindByDocumentId.mockResolvedValue([
			{ id: 1, documentId: 1, chunkIndex: 0, text: 'valid', positionWeight: 0.5, embedding: null },
			{ id: 2, documentId: 1, chunkIndex: 1, text: null, positionWeight: 0.5, embedding: null },
			{ id: 3, documentId: 1, chunkIndex: 2, text: 'no-weight', positionWeight: null, embedding: null },
			{ id: 4, documentId: 1, chunkIndex: 3, text: 'both-null', positionWeight: null, embedding: null },
		])

		const result = await CasesService.getCaseChunks(1)

		expect(result.length).toBe(1)
		expect(result[0].id).toBe(1)
	})

	it('returns empty array when case has no documents', async () => {
		mockDocFindByCaseId.mockResolvedValue([])
		const result = await CasesService.getCaseChunks(99)
		expect(result).toEqual([])
	})

	it('returns empty array when no chunks have weight', async () => {
		mockDocFindByCaseId.mockResolvedValue([{ id: 1, filename: 'doc.pdf' }])
		mockChunkFindByDocumentId.mockResolvedValue([
			{ id: 1, documentId: 1, chunkIndex: 0, text: 'chunk', positionWeight: null, embedding: null },
		])
		const result = await CasesService.getCaseChunks(1)
		expect(result).toEqual([])
	})

	it('limits result to 50 chunks', async () => {
		mockDocFindByCaseId.mockResolvedValue([{ id: 1, filename: 'big.pdf' }])
		const manyChunks = Array.from({ length: 100 }, (_, i) => ({
			id: i, documentId: 1, chunkIndex: i, text: `chunk-${i}`, positionWeight: (100 - i) / 100, embedding: null,
		}))
		mockChunkFindByDocumentId.mockResolvedValue(manyChunks)

		const result = await CasesService.getCaseChunks(1)

		expect(result.length).toBe(50)
	})
})

describe('CasesService.getMentionContexts', () => {
	const participant = { id: 1, documentId: 10, clusterId: 3, normalizedName: 'john-doe' }

	beforeEach(() => {
		mockParticipantFindById.mockReset()
		mockCorefFindByDocumentId.mockReset()
		mockDocFindById.mockReset()
	})

	it('returns empty array when participant not found', async () => {
		mockParticipantFindById.mockResolvedValue(null)
		const result = await CasesService.getMentionContexts(999)
		expect(result).toEqual([])
	})

	it('returns empty array when participant has no clusterId', async () => {
		mockParticipantFindById.mockResolvedValue({ ...participant, clusterId: null })
		const result = await CasesService.getMentionContexts(1)
		expect(result).toEqual([])
	})

	it('returns empty array when no coreference data found', async () => {
		mockParticipantFindById.mockResolvedValue(participant)
		mockCorefFindByDocumentId.mockResolvedValue(null)
		const result = await CasesService.getMentionContexts(1)
		expect(result).toEqual([])
	})

	it('returns empty array when cluster not found in coref', async () => {
		mockParticipantFindById.mockResolvedValue(participant)
		mockCorefFindByDocumentId.mockResolvedValue({
			clusters: [{ clusterIndex: 1, mentions: [] }],
		})
		const result = await CasesService.getMentionContexts(1)
		expect(result).toEqual([])
	})

	it('returns mention text with context when fullContent available', async () => {
		mockParticipantFindById.mockResolvedValue(participant)
		mockCorefFindByDocumentId.mockResolvedValue({
			clusters: [
				{
					clusterIndex: 3,
					mentions: [
						{ text: 'John', startPos: 10, endPos: 14 },
						{ text: 'John Doe', startPos: 100, endPos: 108 },
					],
				},
			],
		})
		mockDocFindById.mockResolvedValue({
			id: 10,
			fullContent: { content: 'A'.repeat(50) + 'John' + 'B'.repeat(50) + 'John Doe' + 'C'.repeat(50) },
		})

		const result = await CasesService.getMentionContexts(1, 120)

		expect(result.length).toBe(2)
		expect(result[0].text).toBe('John')
		expect(result[0].context).toContain('John')
		expect(result[1].text).toBe('John Doe')
	})

	it('falls back to mention text when no fullContent', async () => {
		mockParticipantFindById.mockResolvedValue(participant)
		mockCorefFindByDocumentId.mockResolvedValue({
			clusters: [
				{
					clusterIndex: 3,
					mentions: [{ text: 'Fallback', startPos: 0, endPos: 8 }],
				},
			],
		})
		mockDocFindById.mockResolvedValue({ id: 10, fullContent: null })

		const result = await CasesService.getMentionContexts(1, 120)

		expect(result.length).toBe(1)
		expect(result[0].text).toBe('Fallback')
		expect(result[0].context).toBe('Fallback')
	})

	it('adds ellipsis prefix when excerpt starts after beginning and no suffix when reaching end', async () => {
		mockParticipantFindById.mockResolvedValue(participant)
		mockCorefFindByDocumentId.mockResolvedValue({
			clusters: [{ clusterIndex: 3, mentions: [{ text: 'Target', startPos: 480, endPos: 486 }] }],
		})
		mockDocFindById.mockResolvedValue({
			id: 10,
			fullContent: { content: 'X'.repeat(500) },
		})

		const result = await CasesService.getMentionContexts(1, 50)

		expect(result[0].context.startsWith('\u2026')).toBe(true)
		expect(result[0].context.endsWith('\u2026')).toBe(false)
	})
	it('adds ellipsis suffix when excerpt ends before text end and no prefix when starting at 0', async () => {
		mockParticipantFindById.mockResolvedValue(participant)
		mockCorefFindByDocumentId.mockResolvedValue({
			clusters: [{ clusterIndex: 3, mentions: [{ text: 'Target', startPos: 0, endPos: 6 }] }],
		})
		mockDocFindById.mockResolvedValue({
			id: 10,
			fullContent: { content: 'X'.repeat(500) },
		})

		const result = await CasesService.getMentionContexts(1, 50)

		expect(result[0].context.startsWith('\u2026')).toBe(false)
		expect(result[0].context.endsWith('\u2026')).toBe(true)
	})
})

describe('CasesService.getEntityMentionContexts', () => {
	beforeEach(() => {
		mockDocFindById.mockReset()
	})

	it('handles empty db result', async () => {
		mockDb.select = () => ({
			from: () => ({
				innerJoin: () => ({
					innerJoin: () => ({
						innerJoin: () => ({
							innerJoin: () => ({
								where: () => ({
									orderBy: () => Promise.resolve([]),
								}),
							}),
						}),
					}),
				}),
			}),
		})

		mock.module('@workspace/shared', () => ({
			documentRepository: { findById: mockDocFindById, findByCaseId: mock() },
			chunkRepository: { findByDocumentId: mock() },
			participantRepository: { findById: mock() },
			coreferenceRepository: { findByDocumentId: mock() },
			db: mockDb,
			participants: {}, documents: {}, coreferenceResults: {},
			coreferenceClusters: {}, coreferenceMentions: {},
		}))

		const { CasesService: ReloadedCaseService } = await import('./service')
		const result = await ReloadedCaseService.getEntityMentionContexts('nonexistent', 1)
		expect(result).toEqual([])
	})
})
