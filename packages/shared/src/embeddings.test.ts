import { describe, expect, it } from 'bun:test'
import {
	EMBEDDING_COLUMN_DIMENSIONS,
	EmbeddingDimensionError,
	assertNativeEmbedding,
	cosineSimilarity,
	pgvectorLiteral,
	prepareEmbeddingForColumn,
	toColumnVector,
} from './embeddings'

function unit2(x: number, y: number): number[] {
	const n = Math.hypot(x, y)
	return [x / n, y / n]
}

describe('zero-padding vs cosine', () => {
	it('does not change cosine between same-model vectors', () => {
		const a = unit2(3, 4)
		const b = unit2(1, 2)
		const paddedA = toColumnVector(a, 8)
		const paddedB = toColumnVector(b, 8)
		expect(cosineSimilarity(paddedA, paddedB)).toBeCloseTo(cosineSimilarity(a, b), 10)
	})

	it('mixing different native widths is not a valid comparison (the poison case)', () => {
		// 2-d "nomic" vs 4-d "openai" stuffed into the same column
		const nomic = toColumnVector([1, 0], 4)
		const openai = toColumnVector([0, 0, 1, 0], 4)
		// Orthogonal in the padded space even if both "mean" something similar in their own models
		expect(cosineSimilarity(nomic, openai)).toBeCloseTo(0, 10)
	})
})

describe('prepareEmbeddingForColumn', () => {
	it('pads text-embedding-3-small 1536-d to the pgvector column', () => {
		const native = new Array(1536).fill(0.01)
		native[0] = 1
		const { columnVector, nativeDimensions } = prepareEmbeddingForColumn(
			native,
			'text-embedding-3-small',
		)
		expect(nativeDimensions).toBe(1536)
		expect(columnVector).toHaveLength(EMBEDDING_COLUMN_DIMENSIONS)
		expect(columnVector[0]).toBe(1)
		expect(columnVector[1536]).toBe(0)
		expect(columnVector[3071]).toBe(0)
	})

	it('rejects a vector whose length does not match the model', () => {
		expect(() => prepareEmbeddingForColumn([0.1, 0.2], 'text-embedding-3-small')).toThrow(
			EmbeddingDimensionError,
		)
	})

	it('refuses to truncate', () => {
		expect(() => toColumnVector(new Array(10).fill(1), 4)).toThrow(EmbeddingDimensionError)
	})

	it('accepts unknown models when native width is supplied', () => {
		const v = [0.2, 0.3, 0.4]
		expect(assertNativeEmbedding(v, 'custom-legal-embed', 3)).toBe(3)
	})
})

describe('pgvectorLiteral', () => {
	it('emits the [x,y] form pgvector casts from text', () => {
		expect(pgvectorLiteral([1, 0, 0])).toBe('[1,0,0]')
	})
})
