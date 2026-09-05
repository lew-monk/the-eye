import { describe, expect, it, mock } from 'bun:test'
import { OllamaEmbeddingProvider } from './ollama-provider'

describe('OllamaEmbeddingProvider', () => {
	it('posts a batch to /api/embed and returns checked vectors', async () => {
		const vector = new Array(768).fill(0.01)
		const fetchImpl = mock(async () =>
			new Response(JSON.stringify({ embeddings: [vector] }), { status: 200 }),
		)
		const provider = new OllamaEmbeddingProvider(
			'nomic-embed-text',
			768,
			'http://ollama.test',
			fetchImpl as unknown as typeof fetch,
		)
		const result = await provider.embed({ texts: ['hello'] })
		expect(result.embeddings).toHaveLength(1)
		expect(result.embeddings[0]).toHaveLength(768)
		expect(fetchImpl).toHaveBeenCalledTimes(1)
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('http://ollama.test/api/embed')
		expect(JSON.parse(String(init.body))).toEqual({ model: 'nomic-embed-text', input: ['hello'] })
	})

	it('rejects a vector whose width does not match the model', async () => {
		const fetchImpl = mock(async () =>
			new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }), { status: 200 }),
		)
		const provider = new OllamaEmbeddingProvider(
			'nomic-embed-text',
			768,
			'http://ollama.test',
			fetchImpl as unknown as typeof fetch,
		)
		await expect(provider.embed({ texts: ['hello'] })).rejects.toThrow(/768-d/)
	})
})
