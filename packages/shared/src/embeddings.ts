/**
 * pgvector requires a fixed column typmod (`vector(N)`). Rows therefore live
 * in a wide column (`EMBEDDING_COLUMN_DIMENSIONS`) even when the active model
 * emits fewer dimensions.
 *
 * Zero-padding a native vector v to [v, 0, 0, …] does **not** change cosine
 * similarity between two vectors from the **same** model:
 *
 *   cos([a, 0], [b, 0]) = (a·b) / (|a||b|) = cos(a, b)
 *
 * What *does* poison retrieval is mixing models in one `<=>` scan (e.g. 768-d
 * nomic next to 1536-d OpenAI). Different spaces, incomparable scores.
 * Truncating a longer vector to fit the column is also invalid.
 *
 * Write path: assert native width for the declared model, then pad to column.
 * Query path: pad the query the same way and filter `embedding_model`.
 */

export const EMBEDDING_COLUMN_DIMENSIONS = 3072

/** Native output width of models we actually run. Unknown models must pass dims explicitly. */
export const NATIVE_EMBEDDING_DIMENSIONS: Record<string, number> = {
	'nomic-embed-text': 768,
	'nomic-embed-text-v1.5': 768,
	'text-embedding-3-small': 1536,
	'text-embedding-3-large': 3072,
	'text-embedding-ada-002': 1536,
	'voyage-law-2': 1024,
}

export class EmbeddingDimensionError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'EmbeddingDimensionError'
	}
}

export function nativeDimensionForModel(model: string, fallback?: number): number {
	const known = NATIVE_EMBEDDING_DIMENSIONS[model]
	if (known) return known
	if (typeof fallback === 'number' && fallback > 0) return fallback
	throw new EmbeddingDimensionError(
		`Unknown embedding model "${model}". Pass native dimensions or add it to NATIVE_EMBEDDING_DIMENSIONS.`,
	)
}

export function assertNativeEmbedding(
	values: number[],
	model: string,
	fallbackNativeDim?: number,
): number {
	if (!Array.isArray(values) || values.length === 0) {
		throw new EmbeddingDimensionError('Embedding is empty')
	}
	const expected = nativeDimensionForModel(model, fallbackNativeDim)
	if (values.length !== expected) {
		throw new EmbeddingDimensionError(
			`Model ${model} emits ${expected}-d vectors; received ${values.length}. ` +
				`Refusing to pad/truncate a mismatched native width (mixed-model or bad provider response).`,
		)
	}
	if (expected > EMBEDDING_COLUMN_DIMENSIONS) {
		throw new EmbeddingDimensionError(
			`Model ${model} native width ${expected} exceeds pgvector column ${EMBEDDING_COLUMN_DIMENSIONS}. ` +
				`Add a new column (blue/green) instead of truncating.`,
		)
	}
	return expected
}

/** Pad trailing zeros so pgvector accepts the value. Never truncates. */
export function toColumnVector(values: number[], columnDim = EMBEDDING_COLUMN_DIMENSIONS): number[] {
	if (values.length === columnDim) return values
	if (values.length > columnDim) {
		throw new EmbeddingDimensionError(
			`Cannot store ${values.length}-d vector in vector(${columnDim}); would truncate.`,
		)
	}
	const out = new Array(columnDim)
	for (let i = 0; i < values.length; i++) out[i] = values[i] ?? 0
	for (let i = values.length; i < columnDim; i++) out[i] = 0
	return out
}

export function prepareEmbeddingForColumn(
	values: number[],
	model: string,
	fallbackNativeDim?: number,
): { columnVector: number[]; nativeDimensions: number } {
	const nativeDimensions = assertNativeEmbedding(values, model, fallbackNativeDim)
	return { columnVector: toColumnVector(values), nativeDimensions }
}

export function cosineSimilarity(a: number[], b: number[]): number {
	const n = Math.min(a.length, b.length)
	let dot = 0
	let na = 0
	let nb = 0
	for (let i = 0; i < n; i++) {
		const ai = a[i] ?? 0
		const bi = b[i] ?? 0
		dot += ai * bi
		na += ai * ai
		nb += bi * bi
	}
	for (let i = n; i < a.length; i++) na += (a[i] ?? 0) ** 2
	for (let i = n; i < b.length; i++) nb += (b[i] ?? 0) ** 2
	const denom = Math.sqrt(na) * Math.sqrt(nb)
	if (denom === 0) return 0
	return dot / denom
}

export function pgvectorLiteral(values: number[]): string {
	return `[${values.join(',')}]`
}
