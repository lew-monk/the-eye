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

	it('carries rich extract signals through both page sources', () => {
		const rich = {
			markdown: '# Holding\nbody',
			headings: [{ level: 1, text: 'Holding' }],
			tables: ['| a |\n| --- |\n| b |'],
			pictures: [{ bbox: [0, 0, 10, 10] as [number, number, number, number] }],
			boxes: [{ kind: 'table' as const, bbox: [0, 0, 10, 10] as [number, number, number, number] }],
		}
		const merged = mergeHybridPages(
			[
				{ pageIndex: 0, text: 'digital', needsOcr: false, ...rich },
				{ pageIndex: 1, text: '', needsOcr: true, ...rich },
			],
			{ 1: { content: 'scanned', confidence: 0.9 } },
		)
		for (const page of merged.pages) {
			expect(page.headings).toEqual([{ level: 1, text: 'Holding' }])
			expect(page.tables).toHaveLength(1)
			expect(page.pictures).toHaveLength(1)
			expect(page.boxes).toHaveLength(1)
			expect(page.markdown).toBe('# Holding\nbody')
		}
	})

	it('omits rich keys when the native payload predates them', () => {
		const merged = mergeHybridPages(
			[{ pageIndex: 0, text: 'legacy', needsOcr: false }],
			{},
		)
		expect(merged.pages[0]).toEqual({
			pageIndex: 0,
			source: 'native',
			text: 'legacy',
		})
	})
})
