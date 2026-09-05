import { describe, expect, it, mock } from 'bun:test'

const mockEmbedMany = mock()

mock.module('ai', () => ({
	embedMany: mockEmbedMany,
}))

mock.module('@ai-sdk/openai', () => ({
	openai: { embedding: () => 'openai-model' },
}))

import { OpenAIEmbeddingProvider } from './openai-provider'

describe('OpenAIEmbeddingProvider', () => {
	it('returns embeddings from embedMany and checks native width', async () => {
		const vector = new Array(1536).fill(0.02)
		mockEmbedMany.mockResolvedValueOnce({ embeddings: [vector] })
		const provider = new OpenAIEmbeddingProvider('text-embedding-3-small', 1536)
		const result = await provider.embed({ texts: ['clause'] })
		expect(result.provider).toBe('openai')
		expect(result.embeddings[0]).toHaveLength(1536)
		expect(mockEmbedMany).toHaveBeenCalled()
	})
})
