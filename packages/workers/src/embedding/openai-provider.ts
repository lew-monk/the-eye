import { embedMany } from 'ai'
import { openai } from '@ai-sdk/openai'
import { assertNativeEmbedding } from '@workspace/shared'
import type { EmbeddingProvider, EmbedRequest, EmbedResult } from './types'

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
	readonly name = 'openai' as const

	constructor(
		readonly model: string,
		readonly dimensions: number,
	) {}

	async embed(request: EmbedRequest): Promise<EmbedResult> {
		if (request.texts.length === 0) {
			return { embeddings: [], model: this.model, dimensions: this.dimensions, provider: this.name }
		}

		const { embeddings } = await embedMany({
			model: openai.embedding(this.model, { dimensions: this.dimensions }),
			values: request.texts,
		})

		const checked = embeddings.map((v) => {
			assertNativeEmbedding(v, this.model, this.dimensions)
			return v
		})

		return {
			embeddings: checked,
			model: this.model,
			dimensions: this.dimensions,
			provider: this.name,
		}
	}
}
