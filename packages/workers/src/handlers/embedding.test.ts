import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockFindByDocumentId = mock()
const mockUpdateEmbedding = mock()
const mockUpdateById = mock()
const mockAddProcessingLog = mock()

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

import { embeddingHandler } from './embedding'
import type { EmbeddingProvider } from '../embedding'

const MODEL = 'text-embedding-3-small'

function mockProvider(overrides: Partial<EmbeddingProvider> = {}): EmbeddingProvider {
	const embed = mock(async () => ({
		embeddings: [new Array(1536).fill(0.01)],
		model: MODEL,
		dimensions: 1536,
		provider: 'openai' as const,
	}))
	return {
		name: 'openai',
		model: MODEL,
		dimensions: 1536,
		embed,
		...overrides,
	}
}

describe('embeddingHandler skip-if-unchanged', () => {
	beforeEach(() => {
		mockFindByDocumentId.mockReset()
		mockUpdateEmbedding.mockReset()
		mockUpdateById.mockReset()
		mockAddProcessingLog.mockReset()
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
		const provider = mockProvider()

		const result = await embeddingHandler({ data: { documentId: 1 } }, provider)
		expect(result).toEqual({ skipped: true, reason: 'already_embedded' })
		expect(provider.embed).not.toHaveBeenCalled()
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
		mockUpdateEmbedding.mockResolvedValue(undefined)
		mockUpdateById.mockResolvedValue({})
		mockAddProcessingLog.mockResolvedValue(undefined)
		const provider = mockProvider()

		const result = await embeddingHandler({ data: { documentId: 1 } }, provider)
		expect(result).toEqual({ embedded: 1 })
		expect(provider.embed).toHaveBeenCalledTimes(1)
		expect(mockUpdateEmbedding.mock.calls[0]?.[2]?.model).toBe(MODEL)
	})

	it('embeds children and leaves, not parent rows that have children', async () => {
		mockFindByDocumentId.mockResolvedValue([
			{ id: 10, chunkIndex: 0, text: 'PARENT SECTION', parentChunkIndex: null, tokenCount: 2 },
			{ id: 11, chunkIndex: 1, text: 'child a', parentChunkIndex: 0, tokenCount: 2 },
			{ id: 12, chunkIndex: 2, text: 'child b', parentChunkIndex: 0, tokenCount: 2 },
			{ id: 13, chunkIndex: 3, text: 'leaf', parentChunkIndex: null, tokenCount: 1 },
		])
		mockUpdateEmbedding.mockResolvedValue(undefined)
		mockUpdateById.mockResolvedValue({})
		mockAddProcessingLog.mockResolvedValue(undefined)
		const embed = mock(async ({ texts }: { texts: string[] }) => ({
			embeddings: texts.map(() => new Array(8).fill(0.01)),
			model: MODEL,
			dimensions: 1536,
			provider: 'openai' as const,
		}))
		const provider = mockProvider({ embed })

		const result = await embeddingHandler({ data: { documentId: 1 } }, provider)

		expect(result).toEqual({ embedded: 3 })
		expect(embed.mock.calls[0]?.[0]?.texts).toEqual(['child a', 'child b', 'leaf'])
		expect(mockUpdateEmbedding.mock.calls.map((c) => c[0])).toEqual([11, 12, 13])
	})
})
