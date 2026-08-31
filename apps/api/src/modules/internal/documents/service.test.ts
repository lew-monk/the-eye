import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockDocFindById = mock()
const mockDocUpdateById = mock().mockResolvedValue({})
const mockDocAddProcessingLog = mock().mockResolvedValue(undefined)
const mockChunkDeleteByDocumentId = mock().mockResolvedValue(undefined)
const mockParticipantDeleteByDocumentId = mock().mockResolvedValue(undefined)
const mockCorefDeleteByDocumentId = mock().mockResolvedValue(undefined)
const mockAddDocumentToCorefQueue = mock()

mock.module('@workspace/core', () => ({
	getDocumentQueue: () => ({
		addDocumentToCorefQueue: mockAddDocumentToCorefQueue,
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
	},
	participantRepository: {
		deleteByDocumentId: mockParticipantDeleteByDocumentId,
	},
	coreferenceRepository: {
		deleteByDocumentId: mockCorefDeleteByDocumentId,
	},
}))

import { DocumentsService } from './service'

describe('DocumentsService.reprocess', () => {
	beforeEach(() => {
		mockDocFindById.mockReset()
		mockDocUpdateById.mockReset()
		mockDocAddProcessingLog.mockReset()
		mockChunkDeleteByDocumentId.mockReset()
		mockParticipantDeleteByDocumentId.mockReset()
		mockCorefDeleteByDocumentId.mockReset()
		mockAddDocumentToCorefQueue.mockReset()

		mockDocUpdateById.mockResolvedValue({})
		mockDocAddProcessingLog.mockResolvedValue(undefined)
		mockChunkDeleteByDocumentId.mockResolvedValue(undefined)
		mockParticipantDeleteByDocumentId.mockResolvedValue(undefined)
		mockCorefDeleteByDocumentId.mockResolvedValue(undefined)
		mockAddDocumentToCorefQueue.mockResolvedValue(undefined)
	})

	it('returns null when document not found', async () => {
		mockDocFindById.mockResolvedValue(null)
		const result = await DocumentsService.reprocess(999)
		expect(result).toBeNull()
	})

	it('deletes chunks, participants, and coref data', async () => {
		mockDocFindById.mockResolvedValue({ id: 1, status: 'completed' })

		await DocumentsService.reprocess(1)

		expect(mockChunkDeleteByDocumentId).toHaveBeenCalledWith(1)
		expect(mockParticipantDeleteByDocumentId).toHaveBeenCalledWith(1)
		expect(mockCorefDeleteByDocumentId).toHaveBeenCalledWith(1)
	})

	it('resets document metadata fields', async () => {
		mockDocFindById.mockResolvedValue({ id: 1, status: 'completed' })

		await DocumentsService.reprocess(1)

		expect(mockDocUpdateById).toHaveBeenCalledWith(1, {
			status: 'pending',
			errorMessage: null,
			normalizedText: null,
			embeddingVersion: null,
			embeddingProvider: null,
			embeddingModel: null,
			extractionVersion: null,
		})
	})

	it('logs reprocess_queued action', async () => {
		mockDocFindById.mockResolvedValue({ id: 1, status: 'failed' })

		await DocumentsService.reprocess(1)

		const log = mockDocAddProcessingLog.mock.calls[0]?.[0]
		expect(log.action).toBe('reprocess_queued')
		expect(log.details.previousStatus).toBe('failed')
	})

	it('queues coref when textHash is present', async () => {
		mockDocFindById.mockResolvedValue({ id: 1, status: 'completed', textHash: 'abc123' })

		await DocumentsService.reprocess(1)

		expect(mockAddDocumentToCorefQueue).toHaveBeenCalledWith(1, 'abc123')
	})

	it('skips coref queue when textHash is absent', async () => {
		mockDocFindById.mockResolvedValue({ id: 1, status: 'completed' })

		await DocumentsService.reprocess(1)

		expect(mockAddDocumentToCorefQueue).not.toHaveBeenCalled()
	})

	it('returns success with documentId', async () => {
		mockDocFindById.mockResolvedValue({ id: 42, status: 'completed' })

		const result = await DocumentsService.reprocess(42)

		expect(result).toEqual({ success: true, documentId: 42 })
	})
})
