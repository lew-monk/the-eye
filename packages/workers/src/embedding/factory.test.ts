import { describe, expect, it, afterEach } from 'bun:test'
import { createEmbeddingProvider, resolveEmbeddingProviderName } from './factory'
import { OllamaEmbeddingProvider } from './ollama-provider'
import { OpenAIEmbeddingProvider } from './openai-provider'

const ORIGINAL_PROVIDER = process.env.EMBEDDING_PROVIDER
const ORIGINAL_MODEL = process.env.EMBEDDING_MODEL

afterEach(() => {
	if (ORIGINAL_PROVIDER === undefined) delete process.env.EMBEDDING_PROVIDER
	else process.env.EMBEDDING_PROVIDER = ORIGINAL_PROVIDER
	if (ORIGINAL_MODEL === undefined) delete process.env.EMBEDDING_MODEL
	else process.env.EMBEDDING_MODEL = ORIGINAL_MODEL
})

describe('resolveEmbeddingProviderName', () => {
	it('defaults to openai so production stays on the current path', () => {
		expect(resolveEmbeddingProviderName(undefined)).toBe('openai')
		expect(resolveEmbeddingProviderName('')).toBe('openai')
	})

	it('maps ollama aliases', () => {
		expect(resolveEmbeddingProviderName('ollama')).toBe('ollama')
		expect(resolveEmbeddingProviderName('nomic')).toBe('ollama')
	})
})

describe('createEmbeddingProvider', () => {
	it('builds OpenAI by default', () => {
		const p = createEmbeddingProvider({ EMBEDDING_PROVIDER: 'openai' } as NodeJS.ProcessEnv)
		expect(p).toBeInstanceOf(OpenAIEmbeddingProvider)
		expect(p.model).toBe('text-embedding-3-small')
		expect(p.dimensions).toBe(1536)
	})

	it('builds Ollama when requested', () => {
		const p = createEmbeddingProvider({
			EMBEDDING_PROVIDER: 'ollama',
			EMBEDDING_MODEL: 'nomic-embed-text',
			EMBEDDING_DIMENSIONS: '768',
		} as NodeJS.ProcessEnv)
		expect(p).toBeInstanceOf(OllamaEmbeddingProvider)
		expect(p.model).toBe('nomic-embed-text')
		expect(p.dimensions).toBe(768)
	})
})
