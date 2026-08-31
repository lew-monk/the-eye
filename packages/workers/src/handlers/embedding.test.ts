import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockFindByDocumentId = mock()
const mockUpdateEmbedding = mock()
const mockUpdateById = mock()
const mockAddProcessingLog = mock()
const mockEmbedMany = mock()

mock.module('@workspace/shared', () => ({
	chunkRepository: {
		findByDocumentId: mockFindByDocumentId,
		updateEmbedding: mockUpdateEmbedding,
	},
	documentRepository: {
		updateById: mockUpdateById,
		addProcessingLog: mockAddProcessingLog,
	},
	hashChunkText: (text: string) => `hash:${text}`,
}))

mock.module('ai', () => ({
	embedMany: mockEmbedMany,
}))

mock.module('@ai-sdk/openai', () => ({
	openai: { embedding: () => 'model' },
}))

import { embeddingHandler } from './embedding'

const MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'

describe('embeddingHandler skip-if-unchanged', () => {
	beforeEach(() => {
		mockFindByDocumentId.mockReset()
		mockUpdateEmbedding.mockReset()
		mockUpdateById.mockReset()
		mockAddProcessingLog.mockReset()
		mockEmbedMany.mockReset()
	})

	it('skips chunks that already have vectors for the same model and text hash', async () => {
		mockFindByDocumentId.mockResolvedValue([
			{
				id: 1,
				text: 'hello',
				embedding: new Array(8).fill(0.1),
				embeddingModel: MODEL,
				chunkTextHash: 'hash:hello',
			},
		])

		const result = await embeddingHandler({ data: { documentId: 1 } })
		expect(result).toEqual({ skipped: true, reason: 'already_embedded' })
		expect(mockEmbedMany).not.toHaveBeenCalled()
	})

	it('re-embeds when the model changed', async () => {
		mockFindByDocumentId.mockResolvedValue([
			{
				id: 1,
				text: 'hello',
				embedding: new Array(8).fill(0.1),
				embeddingModel: 'nomic-embed-text',
				chunkTextHash: 'hash:hello',
				tokenCount: 1,
			},
		])
		mockEmbedMany.mockResolvedValue({ embeddings: [new Array(1536).fill(0.01)] })
		mockUpdateEmbedding.mockResolvedValue(undefined)
		mockUpdateById.mockResolvedValue({})
		mockAddProcessingLog.mockResolvedValue(undefined)

		const result = await embeddingHandler({ data: { documentId: 1 } })
		expect(result).toEqual({ embedded: 1 })
		expect(mockUpdateEmbedding.mock.calls[0]?.[2]?.model).toBe(MODEL)
	})
})
