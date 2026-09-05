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

	it('stores chunks and queues embeddings without marking embed complete', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, status: 'processing' })
		const chunks = [{ chunkIndex: 0, text: 'hello' }]
		const inserted = [{ id: 1, ...chunks[0], documentId: DOC_ID }]
		mockChunkCreateMany.mockResolvedValue(inserted)

		const result = await ChunksService.store(DOC_ID, chunks, 0, 'none', 'none')

		expect(result).toEqual({ count: 1, embeddingsPending: true })
		expect(mockChunkDeleteByDocumentId).toHaveBeenCalledWith(DOC_ID)
		expect(mockChunkCreateMany).toHaveBeenCalled()
		// pending embeddings → do not set embeddingVersion on document yet
		expect(mockDocUpdateById).not.toHaveBeenCalled()
		expect(mockAddDocumentChunkToQueue).toHaveBeenCalledWith(DOC_ID)
	})

	it('stores pre-embedded chunks and updates document embedding metadata', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, status: 'processing' })
		const chunks = [{ chunkIndex: 0, text: 'hello', embedding: [0.1, 0.2] }]
		mockChunkCreateMany.mockResolvedValue([{ id: 1, ...chunks[0], documentId: DOC_ID }])

		const result = await ChunksService.store(DOC_ID, chunks, VER, PROVIDER, MODEL)

		expect(result).toEqual({ count: 1, embeddingsPending: false })
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

		await ChunksService.store(DOC_ID, [{ chunkIndex: 0, text: 'hello' }], 0, 'none', 'none', 'normalized')

		const updateArg = mockDocUpdateById.mock.calls[0]?.[1]
		expect(updateArg.normalizedText).toBe('normalized')
		expect(updateArg.embeddingVersion).toBeUndefined()
	})

	it('does not update document when no normalizedText and embeddings pending', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, status: 'processing' })
		mockChunkCreateMany.mockResolvedValue([{ id: 1 }])

		await ChunksService.store(DOC_ID, [{ chunkIndex: 0, text: 'hello' }], 0, 'none', 'none')

		expect(mockDocUpdateById).not.toHaveBeenCalled()
	})

	it('handles empty chunks array', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, status: 'processing' })
		mockChunkCreateMany.mockResolvedValue([])

		const result = await ChunksService.store(DOC_ID, [], 0, 'none', 'none')

		expect(result).toEqual({ count: 0, embeddingsPending: true })
		expect(mockChunkCreateMany).toHaveBeenCalledWith([])
	})

	it('passes through null parentChunkIndex', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, status: 'processing' })
		mockChunkCreateMany.mockResolvedValue([{ id: 1 }])

		await ChunksService.store(DOC_ID, [
			{ chunkIndex: 0, text: 'a', parentChunkIndex: null },
		], 0, 'none', 'none')

		const rows = mockChunkCreateMany.mock.calls[0]?.[0]
		expect(rows[0].parentChunkIndex).toBeNull()
	})

	it('strips empty embedding arrays and keeps provider on rows', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, status: 'processing' })
		mockChunkCreateMany.mockResolvedValue([{ id: 1 }, { id: 2 }])

		await ChunksService.store(DOC_ID, [
			{ chunkIndex: 0, text: 'a', embedding: [] },
			{ chunkIndex: 1, text: 'b' },
		], 0, 'none', 'none')

		const rows = mockChunkCreateMany.mock.calls[0]?.[0]
		expect(rows.length).toBe(2)
		expect(rows[0].documentId).toBe(DOC_ID)
		expect(rows[0].embeddingProvider).toBe('none')
		expect(rows[0].embeddingModel).toBe('none')
		expect(rows[0].embedding).toBeUndefined()
	})

	it('logs chunks_stored action', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, status: 'processing' })
		mockChunkCreateMany.mockResolvedValue([{ id: 1 }])

		await ChunksService.store(DOC_ID, [{ chunkIndex: 0, text: 'hello' }], 0, 'none', 'none')

		const log = mockDocAddProcessingLog.mock.calls[0]?.[0]
		expect(log.action).toBe('chunks_stored')
		expect(log.details.count).toBe(1)
		expect(log.details.version).toBe(0)
		expect(log.details.provider).toBe('none')
		expect(log.details.embeddingsPending).toBe(true)
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
		expect(result!.indexIncomplete).toBe(true)
	})

	it('computes combined score from entity overlap and embeddings', async () => {
		mockDocFindById.mockResolvedValue({ id: 1, status: 'completed', embeddingModel: 'text-embedding-3-small' })
		mockParticipantFindEntityOverlap.mockResolvedValue([
			{ id: 2, entitySimilarity: 0.8, caseNumber: 'CASE-A', documentType: 'judgment' },
		])
		mockChunkFindByDocumentId.mockResolvedValue([
			{ id: 10, documentId: 1, chunkIndex: 0, text: 'a', embedding: new Array(1536).fill(0.01), positionWeight: 1.0, embeddingDimensions: 1536 },
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
		expect(result!.indexIncomplete).toBe(false)
		expect(mockChunkFindSimilarChunks.mock.calls[0]?.[3]).toEqual({
			embeddingModel: 'text-embedding-3-small',
			nativeDimensions: 1536,
		})
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
		expect(result!.indexIncomplete).toBe(true)
		expect(mockChunkFindSimilarChunks).not.toHaveBeenCalled()
	})

	it('sorts results by descending score and respects limit', async () => {
		mockDocFindById.mockResolvedValue({ id: 1, status: 'completed', embeddingModel: 'text-embedding-3-small' })
		mockParticipantFindEntityOverlap.mockResolvedValue([
			{ id: 2, entitySimilarity: 0.9, caseNumber: 'CASE-C', documentType: 'judgment' },
			{ id: 3, entitySimilarity: 0.3, caseNumber: 'CASE-D', documentType: 'other' },
			{ id: 4, entitySimilarity: 0.6, caseNumber: 'CASE-E', documentType: 'motion' },
		])
		mockChunkFindByDocumentId.mockResolvedValue([
			{ id: 10, documentId: 1, chunkIndex: 0, text: 'a', embedding: new Array(1536).fill(0.01), positionWeight: 1.0 },
		])
		mockChunkFindSimilarChunks.mockResolvedValue([])

		const result = await ChunksService.getSimilar(1, { ...OPTS, limit: 2 })

		expect(result!.similarCases.length).toBe(2)
		expect(result!.similarCases[0].score).toBeGreaterThanOrEqual(result!.similarCases[1].score)
	})

	it('builds correct reasons', async () => {
		mockDocFindById.mockResolvedValue({ id: 1, status: 'completed', embeddingModel: 'text-embedding-3-small' })
		mockParticipantFindEntityOverlap.mockResolvedValue([
			{ id: 2, entitySimilarity: 0.6, caseNumber: 'CASE-F', documentType: 'pleading' },
		])
		mockChunkFindByDocumentId.mockResolvedValue([
			{ id: 10, documentId: 1, chunkIndex: 0, text: 'a', embedding: new Array(1536).fill(0.01), positionWeight: 1.0 },
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
