import { describe, it, expect } from 'bun:test'
import { PDFDocument } from 'pdf-lib'
import {
	DEFAULT_MAX_CHUNK_BYTES,
	DEFAULT_MAX_PAGES_PER_CHUNK,
	MAX_PAGES_PER_CHUNK,
	shouldSplit,
	getPdfPageCount,
	splitPdfByPages,
	reassembleOcrResults,
	type ChunkOcrResult,
} from '../src/services/ocr/pdf-chunker'

async function makePdf(pageCount: number): Promise<Buffer> {
	const doc = await PDFDocument.create()
	for (let i = 0; i < pageCount; i++) {
		doc.addPage()
	}
	const bytes = await doc.save()
	return Buffer.from(bytes)
}

describe('shouldSplit', () => {
	it('returns false when under page and size limits', () => {
		expect(shouldSplit(1024, 10, 4 * 1024 * 1024, 50)).toBe(false)
	})

	it('returns true when page count exceeds max per chunk', () => {
		expect(shouldSplit(1024, MAX_PAGES_PER_CHUNK + 1, 4 * 1024 * 1024, MAX_PAGES_PER_CHUNK)).toBe(true)
	})

	it('returns true when byte length exceeds free-tier safe bytes', () => {
		const overSafe = 5 * 1024 * 1024
		expect(shouldSplit(overSafe, 10, 4 * 1024 * 1024, 50)).toBe(true)
	})

	it('returns false at exactly max pages per chunk', () => {
		expect(shouldSplit(1024, MAX_PAGES_PER_CHUNK, 4 * 1024 * 1024, MAX_PAGES_PER_CHUNK)).toBe(false)
	})

	it('defaults are free-tier safe', () => {
		expect(DEFAULT_MAX_CHUNK_BYTES).toBeLessThanOrEqual(4 * 1024 * 1024)
		expect(DEFAULT_MAX_PAGES_PER_CHUNK).toBeLessThanOrEqual(100)
	})
})

describe('getPdfPageCount', () => {
	it('returns page count for a multi-page PDF', async () => {
		const buffer = await makePdf(5)
		expect(await getPdfPageCount(buffer)).toBe(5)
	})
})

describe('splitPdfByPages', () => {
	it('returns a single chunk when under max pages and size', async () => {
		const buffer = await makePdf(3)
		const chunks = await splitPdfByPages(buffer, 10, undefined, 4 * 1024 * 1024)
		expect(chunks).toHaveLength(1)
		expect(chunks[0].pageOffset).toBe(0)
		expect(chunks[0].pageCount).toBe(3)
		expect(await getPdfPageCount(chunks[0].buffer)).toBe(3)
	})

	it('splits into chunks with correct page offsets by page limit', async () => {
		const buffer = await makePdf(5)
		const chunks = await splitPdfByPages(buffer, 2, undefined, 4 * 1024 * 1024)
		expect(chunks).toHaveLength(3)
		expect(chunks.map((c) => c.pageOffset)).toEqual([0, 2, 4])
		expect(chunks.map((c) => c.pageCount)).toEqual([2, 2, 1])
		for (const chunk of chunks) {
			expect(await getPdfPageCount(chunk.buffer)).toBe(chunk.pageCount)
		}
	})

	it('keeps every chunk under maxBytes (size-aware fit)', async () => {
		// Blank pages share PDF structure (5p≈621B, 1p≈583B); 590 allows only 1 page per chunk
		const buffer = await makePdf(5)
		const maxBytes = 590
		const chunks = await splitPdfByPages(buffer, 50, undefined, maxBytes)
		expect(chunks.length).toBe(5)
		for (const chunk of chunks) {
			expect(chunk.buffer.byteLength).toBeLessThanOrEqual(maxBytes)
			expect(chunk.pageCount).toBe(1)
		}
	})
})

describe('reassembleOcrResults', () => {
	it('concatenates content in order and remaps pages', () => {
		const chunkResults: ChunkOcrResult[] = [
			{
				id: '1',
				content: 'page one text',
				confidence: 0.9,
				structuredData: { pages: [{ pageNumber: 1 }] },
				extractedFields: { A: '1' },
			},
			{
				id: '1',
				content: 'page three text',
				confidence: 0.7,
				structuredData: { pages: [{ pageNumber: 1 }] },
				extractedFields: { B: '2' },
			},
		]
		const chunks = [
			{ buffer: Buffer.alloc(0), pageOffset: 0, pageCount: 2 },
			{ buffer: Buffer.alloc(0), pageOffset: 2, pageCount: 1 },
		]

		const merged = reassembleOcrResults(chunkResults, chunks, '1')

		expect(merged.content).toBe('page one text\npage three text')
		expect(merged.confidence).toBeCloseTo(0.8)
		expect(merged.extractedFields).toEqual({ A: '1', B: '2' })
		expect(merged.structuredData?.pages).toEqual([
			{ pageNumber: 1 },
			{ pageNumber: 3 },
		])
	})
})
