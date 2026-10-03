import { createHash } from 'node:crypto'

export interface EmbedClient {
	embed(texts: string[]): Promise<number[][]>
	model: string
	provider?: string
}

export interface SummaryClient {
	summarize(prompt: string): Promise<string>
	model: string
}

export function chunkText(text: string, chunkSize = 1000, overlap = 100): string[] {
	if (!text) return []
	if (chunkSize <= 0) throw new Error('chunkSize must be positive')
	if (overlap < 0 || overlap >= chunkSize) throw new Error('overlap must satisfy 0 <= overlap < chunkSize')
	const chunks: string[] = []
	let start = 0
	while (start < text.length) {
		const end = Math.min(start + chunkSize, text.length)
		chunks.push(text.slice(start, end))
		if (end === text.length) break
		start = end - overlap
	}
	return chunks
}

export function buildSummaryPrompt(ocrText: string, maxChars = 12_000): string {
	const truncated = ocrText.length > maxChars ? ocrText.slice(0, maxChars) : ocrText
	return [
		'Summarize the following judgment in 5 sentences or fewer.',
		'Include parties, holding, and key dates. Do not invent citations.',
		'---',
		truncated,
	].join('\n')
}

export function hashText(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Cheap-LLM summary default model: cheapest configured, pinned at build. */
export function resolveSummaryModel(env: NodeJS.ProcessEnv = process.env): string {
	if (env.SUMMARY_MODEL) return env.SUMMARY_MODEL
	const embeddingProvider = (env.EMBEDDING_PROVIDER ?? 'openai').toLowerCase()
	if (embeddingProvider === 'ollama' || embeddingProvider === 'nomic') return env.OLLAMA_MODEL ?? 'llama3.1:8b'
	return 'gpt-4o-mini'
}
