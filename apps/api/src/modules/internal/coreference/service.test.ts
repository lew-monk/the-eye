import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockDocFindById = mock()
const mockDocAddProcessingLog = mock().mockResolvedValue(undefined)
const mockCorefStore = mock()
const mockCorefGetSourceTextHash = mock()

mock.module('@workspace/shared', () => ({
	documentRepository: {
		findById: mockDocFindById,
		addProcessingLog: mockDocAddProcessingLog,
	},
	coreferenceRepository: {
		store: mockCorefStore,
		getSourceTextHash: mockCorefGetSourceTextHash,
	},
}))

import { CoreferenceService } from './service'

describe('CoreferenceService.getExtractedText', () => {
	beforeEach(() => {
		mockDocFindById.mockReset()
		mockCorefGetSourceTextHash.mockReset()
	})

	it('returns null when document not found', async () => {
		mockDocFindById.mockResolvedValue(null)
		const result = await CoreferenceService.getExtractedText(999)
		expect(result).toBeNull()
	})

	it('returns text from fullContent.content', async () => {
		mockDocFindById.mockResolvedValue({
			id: 1, fullContent: { content: 'Hello world' }, documentType: 'judgment',
			status: 'completed', textHash: 'abc', fileHash: 'def',
		})
		mockCorefGetSourceTextHash.mockResolvedValue('hash123')

		const result = await CoreferenceService.getExtractedText(1)

		expect(result).not.toBeNull()
		expect(result!.text).toBe('Hello world')
		expect(result!.documentType).toBe('judgment')
		expect(result!.textHash).toBe('abc')
		expect(result!.fileHash).toBe('def')
		expect(result!.coreferenceSourceTextHash).toBe('hash123')
	})

	it('returns empty text when fullContent is not an object', async () => {
		mockDocFindById.mockResolvedValue({
			id: 2, fullContent: null, documentType: 'other', status: 'pending',
		})
		mockCorefGetSourceTextHash.mockResolvedValue(null)

		const result = await CoreferenceService.getExtractedText(2)

		expect(result!.text).toBe('')
		expect(result!.textHash).toBeNull()
	})

	it('returns empty text when fullContent has no content property', async () => {
		mockDocFindById.mockResolvedValue({
			id: 3, fullContent: {}, documentType: 'contract', status: 'processing',
		})
		mockCorefGetSourceTextHash.mockResolvedValue(null)

		const result = await CoreferenceService.getExtractedText(3)

		expect(result!.text).toBe('')
	})
})

describe('CoreferenceService.storeCoreference', () => {
	const body = {
		resolved_text: 'Resolved text',
		model: 'gpt-4',
		model_version: '1.0',
		source_text_hash: 'hash123',
		processed_at: '2024-01-01T00:00:00Z',
		processing_time_ms: 5000,
		input_char_count: 1000,
		chunked: true,
		chunk_size: 500,
		chunk_count: 2,
		clusters: [{ clusterIndex: 0, mentions: [] }],
		mentions: [{ text: 'hello', startPos: 0, endPos: 5 }],
	}

	beforeEach(() => {
		mockDocFindById.mockReset()
		mockCorefStore.mockReset()
		mockDocAddProcessingLog.mockReset()
	})

	it('returns null when document not found', async () => {
		mockDocFindById.mockResolvedValue(null)
		const result = await CoreferenceService.storeCoreference(999, body)
		expect(result).toBeNull()
	})

	it('returns hashMismatch when textHash differs', async () => {
		mockDocFindById.mockResolvedValue({
			id: 1, textHash: 'hash_different',
		})
		const result = await CoreferenceService.storeCoreference(1, body)
		expect(result).toEqual({ hashMismatch: true })
	})

	it('stores coreference data and logs success', async () => {
		mockDocFindById.mockResolvedValue({
			id: 1, textHash: 'hash123',
		})
		mockCorefStore.mockResolvedValue({ id: 1 })

		const result = await CoreferenceService.storeCoreference(1, body)

		expect(result).toEqual({ success: true })
		expect(mockCorefStore).toHaveBeenCalledWith(1, {
			resolvedText: 'Resolved text',
			model: 'gpt-4',
			modelVersion: '1.0',
			sourceTextHash: 'hash123',
			processedAt: '2024-01-01T00:00:00Z',
			processingTimeMs: 5000,
			inputCharCount: 1000,
			chunked: true,
			chunkSize: 500,
			chunkCount: 2,
			clusters: [{ clusterIndex: 0, mentions: [] }],
			mentions: [{ text: 'hello', startPos: 0, endPos: 5 }],
		})
		expect(mockDocAddProcessingLog).toHaveBeenCalledTimes(1)
		const log = mockDocAddProcessingLog.mock.calls[0]?.[0]
		expect(log.action).toBe('coref_completed')
		expect(log.details.model).toBe('gpt-4')
		expect(log.details.clusters).toBe(1)
		expect(log.details.mentions).toBe(1)
	})

	it('handles null textHash on document (no mismatch check)', async () => {
		mockDocFindById.mockResolvedValue({ id: 2, textHash: null })
		mockCorefStore.mockResolvedValue({ id: 2 })

		const result = await CoreferenceService.storeCoreference(2, body)

		expect(result).toEqual({ success: true })
	})

	it('handles minimal body (no clusters/mentions)', async () => {
		mockDocFindById.mockResolvedValue({ id: 3, textHash: 'hash456' })
		mockCorefStore.mockResolvedValue({ id: 3 })

		const minimalBody = {
			source_text_hash: 'hash456',
			resolved_text: 'Minimal',
		}

		const result = await CoreferenceService.storeCoreference(3, minimalBody)

		expect(result).toEqual({ success: true })
		const log = mockDocAddProcessingLog.mock.calls[0]?.[0]
		expect(log.details.clusters).toBeUndefined()
		expect(log.details.mentions).toBeUndefined()
	})

	it('skips hashMismatch check when document has no textHash', async () => {
		mockDocFindById.mockResolvedValue({ id: 4, textHash: null })
		mockCorefStore.mockResolvedValue({ id: 4 })

		const result = await CoreferenceService.storeCoreference(4, { source_text_hash: 'anything', resolved_text: 'hi' })

		expect(result).toEqual({ success: true })
	})
})
