import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockDocFindById = mock()
const mockDocUpdateById = mock().mockResolvedValue({})
const mockDocAddProcessingLog = mock().mockResolvedValue(undefined)
const mockChunkDeleteByDocumentId = mock().mockResolvedValue(undefined)
const mockChunkCreateMany = mock()
const mockChunkFindByDocumentId = mock()
const mockChunkFindSimilarChunks = mock()
const mockParticipantFindEntityOverlap = mock()
const mockAddDocumentChunkToQueue = mock()

mock.module('@workspace/core', () => ({
	getDocumentQueue: () => ({
		addDocumentChunkToQueue: mockAddDocumentChunkToQueue,
	}),
}))

mock.module('@workspace/shared', () => ({
	documentRepository: {
		findById: mockDocFindById,
		updateById: mockDocUpdateById,
		addProcessingLog: mockDocAddProcessingLog,
	},
	chunkRepository: {
		deleteByDocumentId: mockChunkDeleteByDocumentId,
		createMany: mockChunkCreateMany,
		findByDocumentId: mockChunkFindByDocumentId,
		findSimilarChunks: mockChunkFindSimilarChunks,
	},
	participantRepository: {
		findEntityOverlap: mockParticipantFindEntityOverlap,
	},
}))

import { ChunksService } from './service'

describe('ChunksService.store', () => {
	const DOC_ID = 10
	const VER = 1
	const PROVIDER = 'openai'
	const MODEL = 'text-embedding-3-small'

	beforeEach(() => {
		mockDocFindById.mockReset()
		mockDocUpdateById.mockReset()
		mockDocAddProcessingLog.mockReset()
		mockChunkDeleteByDocumentId.mockReset()
		mockChunkCreateMany.mockReset()
		mockAddDocumentChunkToQueue.mockReset()

		mockDocUpdateById.mockResolvedValue({})
		mockDocAddProcessingLog.mockResolvedValue(undefined)
		mockChunkDeleteByDocumentId.mockResolvedValue(undefined)
		mockAddDocumentChunkToQueue.mockResolvedValue(undefined)
	})

	it('returns null when document not found', async () => {
		mockDocFindById.mockResolvedValue(null)
		const result = await ChunksService.store(DOC_ID, [], VER, PROVIDER, MODEL)
		expect(result).toBeNull()
	})

	it('stores chunks and updates document with embedding metadata', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, status: 'processing' })
		const chunks = [{ chunkIndex: 0, text: 'hello', embedding: [0.1, 0.2] }]
		const inserted = [{ id: 1, ...chunks[0], documentId: DOC_ID }]
		mockChunkCreateMany.mockResolvedValue(inserted)

		const result = await ChunksService.store(DOC_ID, chunks, VER, PROVIDER, MODEL)

		expect(result).toEqual({ count: 1 })
		expect(mockChunkDeleteByDocumentId).toHaveBeenCalledWith(DOC_ID)
		expect(mockChunkCreateMany).toHaveBeenCalled()
		expect(mockDocUpdateById).toHaveBeenCalledWith(DOC_ID, {
			embeddingVersion: VER,
			embeddingProvider: PROVIDER,
			embeddingModel: MODEL,
		})
		expect(mockAddDocumentChunkToQueue).toHaveBeenCalledWith(DOC_ID)
	})

	it('stores normalizedText when provided', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, status: 'processing' })
		mockChunkCreateMany.mockResolvedValue([{ id: 1 }])

		await ChunksService.store(DOC_ID, [{ chunkIndex: 0, text: 'hello' }], VER, PROVIDER, MODEL, 'normalized')

		const updateArg = mockDocUpdateById.mock.calls[0]?.[1]
		expect(updateArg.normalizedText).toBe('normalized')
	})

	it('does not include normalizedText when undefined', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, status: 'processing' })
		mockChunkCreateMany.mockResolvedValue([{ id: 1 }])

		await ChunksService.store(DOC_ID, [{ chunkIndex: 0, text: 'hello' }], VER, PROVIDER, MODEL)

		const updateArg = mockDocUpdateById.mock.calls[0]?.[1]
		expect(updateArg.normalizedText).toBeUndefined()
	})

	it('handles empty chunks array', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, status: 'processing' })
		mockChunkCreateMany.mockResolvedValue([])

		const result = await ChunksService.store(DOC_ID, [], VER, PROVIDER, MODEL)

		expect(result).toEqual({ count: 0 })
		expect(mockChunkCreateMany).toHaveBeenCalledWith([])
	})

	it('adds documentId, embeddingProvider, and embeddingModel to each chunk row', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, status: 'processing' })
		mockChunkCreateMany.mockResolvedValue([{ id: 1 }, { id: 2 }])

		await ChunksService.store(DOC_ID, [
			{ chunkIndex: 0, text: 'a' },
			{ chunkIndex: 1, text: 'b' },
		], VER, PROVIDER, MODEL)

		const rows = mockChunkCreateMany.mock.calls[0]?.[0]
		expect(rows.length).toBe(2)
		expect(rows[0].documentId).toBe(DOC_ID)
		expect(rows[0].embeddingProvider).toBe(PROVIDER)
		expect(rows[0].embeddingModel).toBe(MODEL)
	})

	it('logs chunks_embedded action', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, status: 'processing' })
		mockChunkCreateMany.mockResolvedValue([{ id: 1 }])

		await ChunksService.store(DOC_ID, [{ chunkIndex: 0, text: 'hello' }], VER, PROVIDER, MODEL)

		const log = mockDocAddProcessingLog.mock.calls[0]?.[0]
		expect(log.action).toBe('chunks_embedded')
		expect(log.details.count).toBe(1)
		expect(log.details.version).toBe(VER)
		expect(log.details.provider).toBe(PROVIDER)
		expect(log.details.normalized).toBe(false)
	})
})

describe('ChunksService.getSimilar', () => {
	const OPTS = { limit: 10, alpha: 0.5, beta: 0.5, gamma: 0 }

	beforeEach(() => {
		mockDocFindById.mockReset()
		mockChunkFindByDocumentId.mockReset()
		mockParticipantFindEntityOverlap.mockReset()
		mockChunkFindSimilarChunks.mockReset()
	})

	it('returns null when target document not found', async () => {
		mockDocFindById.mockResolvedValue(null)
		const result = await ChunksService.getSimilar(999, OPTS)
		expect(result).toBeNull()
	})

	it('returns empty similarCases when no candidates found', async () => {
		mockDocFindById.mockResolvedValue({ id: 1, status: 'completed' })
		mockParticipantFindEntityOverlap.mockResolvedValue([])
		mockChunkFindByDocumentId.mockResolvedValue([])

		const result = await ChunksService.getSimilar(1, OPTS)

		expect(result).not.toBeNull()
		expect(result!.similarCases).toEqual([])
	})

	it('computes combined score from entity overlap and embeddings', async () => {
		mockDocFindById.mockResolvedValue({ id: 1, status: 'completed' })
		mockParticipantFindEntityOverlap.mockResolvedValue([
			{ id: 2, entitySimilarity: 0.8, caseNumber: 'CASE-A', documentType: 'judgment' },
		])
		mockChunkFindByDocumentId.mockResolvedValue([
			{ id: 10, documentId: 1, chunkIndex: 0, text: 'a', embedding: new Float32Array([0.1, 0.2]), positionWeight: 1.0 },
		])
		mockChunkFindSimilarChunks.mockResolvedValue([
			{ documentId: 2, cosineSimilarity: 0.7 },
		])

		const result = await ChunksService.getSimilar(1, { alpha: 0.5, beta: 0.5, gamma: 0, limit: 10 })

		expect(result!.similarCases.length).toBe(1)
		expect(result!.similarCases[0].caseId).toBe(2)
		expect(result!.similarCases[0].score).toBeCloseTo(0.75, 2)
		expect(result!.similarCases[0].breakdown.entityOverlap).toBe(0.8)
		expect(result!.similarCases[0].breakdown.embeddingCos).toBe(0.7)
		expect(result!.similarCases[0].reasons.length).toBe(2)
	})

	it('handles target document with no embeddings', async () => {
		mockDocFindById.mockResolvedValue({ id: 1, status: 'completed' })
		mockParticipantFindEntityOverlap.mockResolvedValue([
			{ id: 2, entitySimilarity: 0.5, caseNumber: 'CASE-B', documentType: 'contract' },
		])
		mockChunkFindByDocumentId.mockResolvedValue([
			{ id: 10, documentId: 1, chunkIndex: 0, text: 'a', embedding: null, positionWeight: null },
		])

		const result = await ChunksService.getSimilar(1, OPTS)

		expect(result!.similarCases.length).toBe(1)
		expect(result!.similarCases[0].score).toBeCloseTo(0.25, 2)
		expect(result!.similarCases[0].breakdown.embeddingCos).toBeNull()
	})

	it('sorts results by descending score and respects limit', async () => {
		mockDocFindById.mockResolvedValue({ id: 1, status: 'completed' })
		mockParticipantFindEntityOverlap.mockResolvedValue([
			{ id: 2, entitySimilarity: 0.9, caseNumber: 'CASE-C', documentType: 'judgment' },
			{ id: 3, entitySimilarity: 0.3, caseNumber: 'CASE-D', documentType: 'other' },
			{ id: 4, entitySimilarity: 0.6, caseNumber: 'CASE-E', documentType: 'motion' },
		])
		mockChunkFindByDocumentId.mockResolvedValue([
			{ id: 10, documentId: 1, chunkIndex: 0, text: 'a', embedding: new Float32Array([0.1]), positionWeight: 1.0 },
		])
		mockChunkFindSimilarChunks.mockResolvedValue([])

		const result = await ChunksService.getSimilar(1, { ...OPTS, limit: 2 })

		expect(result!.similarCases.length).toBe(2)
		expect(result!.similarCases[0].score).toBeGreaterThanOrEqual(result!.similarCases[1].score)
	})

	it('builds correct reasons', async () => {
		mockDocFindById.mockResolvedValue({ id: 1, status: 'completed' })
		mockParticipantFindEntityOverlap.mockResolvedValue([
			{ id: 2, entitySimilarity: 0.6, caseNumber: 'CASE-F', documentType: 'pleading' },
		])
		mockChunkFindByDocumentId.mockResolvedValue([
			{ id: 10, documentId: 1, chunkIndex: 0, text: 'a', embedding: new Float32Array([0.1]), positionWeight: 1.0 },
		])
		mockChunkFindSimilarChunks.mockResolvedValue([
			{ documentId: 2, cosineSimilarity: 0.4 },
		])

		const result = await ChunksService.getSimilar(1, OPTS)

		expect(result!.similarCases[0].reasons).toEqual([
			'Shared participants (entity overlap: 0.60)',
			'Similar legal substance (embedding: 0.40)',
		])
	})
})
