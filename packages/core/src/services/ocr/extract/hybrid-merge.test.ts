import { describe, expect, it } from 'bun:test'
import { mergeHybridPages } from './hybrid-merge'

describe('mergeHybridPages', () => {
	it('keeps native text and fills OCR pages from Azure', () => {
		const merged = mergeHybridPages(
			[
				{ pageIndex: 0, text: 'digital holding', needsOcr: false },
				{ pageIndex: 1, text: '', needsOcr: true },
			],
			{ 1: { content: 'scanned affidavit', confidence: 0.8 } },
		)
		expect(merged.pages[0]?.source).toBe('native')
		expect(merged.pages[1]?.source).toBe('azure-ocr')
		expect(merged.content).toBe('digital holding\n\nscanned affidavit')
		expect(merged.confidence).toBeCloseTo(0.8)
	})

	it('treats an all-native PDF as confidence 1', () => {
		const merged = mergeHybridPages(
			[{ pageIndex: 0, text: 'judgment', needsOcr: false }],
			{},
		)
		expect(merged.confidence).toBe(1)
		expect(merged.pages).toHaveLength(1)
	})
})
