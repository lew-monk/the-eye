import { describe, expect, it, mock } from 'bun:test'
import { PDFDocument } from 'pdf-lib'
import { HybridPdfExtractStrategy } from './hybrid-strategy'

async function makePdf(pageCount: number): Promise<Buffer> {
	const doc = await PDFDocument.create()
	for (let i = 0; i < pageCount; i++) doc.addPage()
	return Buffer.from(await doc.save())
}

describe('HybridPdfExtractStrategy', () => {
	it('sends only needsOcr pages through Azure and keeps native text', async () => {
		const analyze = mock(async (_id: number, _buf: Buffer) => ({
			id: '1',
			content: 'azure page',
			confidence: 0.7,
		}))
		const nativeExtract = mock(async () => ({
			extractor: 'pymupdf',
			pageCount: 2,
			pages: [
				{ pageIndex: 0, text: 'native judgment', needsOcr: false },
				{ pageIndex: 1, text: '', needsOcr: true },
			],
		}))
		const strategy = new HybridPdfExtractStrategy(analyze as any, nativeExtract as any)
		const result = await strategy.extract(9, await makePdf(2))

		expect(analyze).toHaveBeenCalledTimes(1)
		expect(result.content).toContain('native judgment')
		expect(result.content).toContain('azure page')
		expect(result.structuredData?.extractor).toBe('pymupdf4llm-hybrid')
		expect(result.structuredData?.pages?.[0]?.source).toBe('native')
		expect(result.structuredData?.pages?.[1]?.source).toBe('azure-ocr')
	})

	it('skips Azure when every page is native', async () => {
		const analyze = mock(async () => ({ id: '1', content: 'should not run', confidence: 0 }))
		const nativeExtract = mock(async () => ({
			extractor: 'pymupdf',
			pageCount: 1,
			pages: [{ pageIndex: 0, text: 'all digital', needsOcr: false }],
		}))
		const strategy = new HybridPdfExtractStrategy(analyze as any, nativeExtract as any)
		const result = await strategy.extract(1, await makePdf(1))
		expect(analyze).not.toHaveBeenCalled()
		expect(result.content).toBe('all digital')
		expect(result.confidence).toBe(1)
	})
})
