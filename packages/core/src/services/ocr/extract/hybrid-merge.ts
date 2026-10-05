export interface PageHeading {
	level: number
	text: string
}

export interface PageBox {
	kind: 'heading' | 'table' | 'picture'
	bbox?: [number, number, number, number]
	level?: number
	text?: string
}

export interface PagePicture {
	bbox: [number, number, number, number]
	width?: number | null
	height?: number | null
}

export interface NativePage {
	pageIndex: number
	text: string
	needsOcr: boolean
	// Rich extract signals from pdf_extract.py (absent on older payloads).
	markdown?: string
	headings?: PageHeading[]
	tables?: string[]
	pictures?: PagePicture[]
	boxes?: PageBox[]
}

export interface OcrPageResult {
	content: string
	confidence: number
}

export interface HybridPageRecord {
	pageIndex: number
	source: 'native' | 'azure-ocr'
	text: string
	markdown?: string
	headings?: PageHeading[]
	tables?: string[]
	pictures?: PagePicture[]
	boxes?: PageBox[]
}

function richSignals(p: NativePage): Partial<HybridPageRecord> {
	return {
		...(p.markdown !== undefined ? { markdown: p.markdown } : {}),
		...(p.headings !== undefined ? { headings: p.headings } : {}),
		...(p.tables !== undefined ? { tables: p.tables } : {}),
		...(p.pictures !== undefined ? { pictures: p.pictures } : {}),
		...(p.boxes !== undefined ? { boxes: p.boxes } : {}),
	}
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
				...richSignals(p),
			}
		}
		return {
			pageIndex: p.pageIndex,
			source: 'native' as const,
			text: (p.text ?? '').trim(),
			...richSignals(p),
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
