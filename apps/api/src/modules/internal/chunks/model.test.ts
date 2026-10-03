import { describe, it, expect } from 'bun:test'
import { getSchemaValidator } from 'elysia'
import { ChunkModel } from './model'

// Use public entry point. It exposes the same check behavior.
const check = getSchemaValidator(ChunkModel.body)

const baseBody = {
	chunks: [{ chunkIndex: 0, text: 'hello' }],
	embeddingVersion: 0,
	embeddingProvider: 'none',
	embeddingModel: 'none',
}

describe('ChunkModel.body', () => {
	it('accepts omitted parentChunkIndex', () => {
		expect(check.Check(baseBody)).toBe(true)
	})

	it('accepts numeric parentChunkIndex', () => {
		expect(
			check.Check({
				...baseBody,
				chunks: [{ ...baseBody.chunks[0], parentChunkIndex: 0 }],
			}),
		).toBe(true)
	})

	it('accepts null parentChunkIndex from the worker payload', () => {
		expect(
			check.Check({
				...baseBody,
				chunks: [{ ...baseBody.chunks[0], parentChunkIndex: null }],
			}),
		).toBe(true)
	})
})
