import { nativeDimensionForModel } from '@workspace/shared'
import { OllamaEmbeddingProvider } from './ollama-provider'
import { OpenAIEmbeddingProvider } from './openai-provider'
import type { EmbeddingProvider, EmbeddingProviderName } from './types'

export function resolveEmbeddingProviderName(
	raw = process.env.EMBEDDING_PROVIDER,
): EmbeddingProviderName {
	const v = (raw || 'openai').trim().toLowerCase()
	if (v === 'ollama' || v === 'nomic') return 'ollama'
	return 'openai'
}

export function createEmbeddingProvider(
	env: NodeJS.ProcessEnv = process.env,
): EmbeddingProvider {
	const name = resolveEmbeddingProviderName(env.EMBEDDING_PROVIDER)
	const model =
		env.EMBEDDING_MODEL ||
		(name === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small')
	const envDims = Number(env.EMBEDDING_DIMENSIONS)
	const dimensions =
		Number.isFinite(envDims) && envDims > 0
			? envDims
			: nativeDimensionForModel(model, name === 'ollama' ? 768 : 1536)

	if (name === 'ollama') {
		return new OllamaEmbeddingProvider(model, dimensions, env.OLLAMA_HOST)
	}
	return new OpenAIEmbeddingProvider(model, dimensions)
}
