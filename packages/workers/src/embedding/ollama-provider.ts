import { assertNativeEmbedding } from '@workspace/shared'
import type { EmbeddingProvider, EmbedRequest, EmbedResult } from './types'

export class OllamaEmbeddingProvider implements EmbeddingProvider {
	readonly name = 'ollama' as const

	constructor(
		readonly model: string,
		readonly dimensions: number,
		private readonly baseUrl = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	async embed(request: EmbedRequest): Promise<EmbedResult> {
		if (request.texts.length === 0) {
			return { embeddings: [], model: this.model, dimensions: this.dimensions, provider: this.name }
		}

		const url = `${this.baseUrl.replace(/\/$/, '')}/api/embed`
		const response = await this.fetchImpl(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ model: this.model, input: request.texts }),
		})
		if (!response.ok) {
			const body = await response.text().catch(() => '')
			throw new Error(`Ollama embed failed ${response.status}: ${body || response.statusText}`)
		}
		const json = (await response.json()) as { embeddings?: number[][] }
		const embeddings = json.embeddings
		if (!Array.isArray(embeddings) || embeddings.length !== request.texts.length) {
			throw new Error(
				`Ollama embed expected ${request.texts.length} vectors, got ${embeddings?.length ?? 0}`,
			)
		}

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
