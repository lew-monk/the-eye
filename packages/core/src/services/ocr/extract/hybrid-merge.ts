export interface NativePage {
	pageIndex: number
	text: string
	needsOcr: boolean
}

export interface OcrPageResult {
	content: string
	confidence: number
}

export interface HybridPageRecord {
	pageIndex: number
	source: 'native' | 'azure-ocr'
	text: string
}

export function mergeHybridPages(
	nativePages: NativePage[],
	ocrByPage: Record<number, OcrPageResult>,
): { content: string; confidence: number; pages: HybridPageRecord[] } {
	const pages: HybridPageRecord[] = nativePages.map((p) => {
		if (p.needsOcr) {
			const ocr = ocrByPage[p.pageIndex]
			return {
				pageIndex: p.pageIndex,
				source: 'azure-ocr' as const,
				text: (ocr?.content ?? p.text ?? '').trim(),
			}
		}
		return {
			pageIndex: p.pageIndex,
			source: 'native' as const,
			text: (p.text ?? '').trim(),
		}
	})

	const ocrConfidences = nativePages
		.filter((p) => p.needsOcr)
		.map((p) => ocrByPage[p.pageIndex]?.confidence)
		.filter((c): c is number => typeof c === 'number')

	const content = pages
		.map((p) => p.text)
		.filter(Boolean)
		.join('\n\n')

	const confidence =
		ocrConfidences.length > 0
			? ocrConfidences.reduce((a, b) => a + b, 0) / ocrConfidences.length
			: nativePages.length > 0
				? 1
				: 0

	return { content, confidence, pages }
}
