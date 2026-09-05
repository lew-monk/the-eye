export type EmbeddingProviderName = 'openai' | 'ollama'

export interface EmbedRequest {
	texts: string[]
}

export interface EmbedResult {
	embeddings: number[][]
	model: string
	dimensions: number
	provider: EmbeddingProviderName
}

export interface EmbeddingProvider {
	readonly name: EmbeddingProviderName
	readonly model: string
	readonly dimensions: number
	embed(request: EmbedRequest): Promise<EmbedResult>
}
