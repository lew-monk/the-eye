import { PDFDocument } from 'pdf-lib'

/**
 * Azure Document Intelligence limits (F0 free tier is the strictest):
 * - Free (F0): ~4 MB per analyze request
 * - Paid (S0): up to 500 MB / 2000 pages
 *
 * Default stays under free tier. Override with AZURE_MAX_CHUNK_BYTES / AZURE_MAX_CHUNK_PAGES.
 */
export const AZURE_FREE_TIER_MAX_BYTES = 4 * 1024 * 1024
/** Slight headroom under 4MB so base64/headers don't push over the wire limit. */
export const DEFAULT_MAX_CHUNK_BYTES = Math.floor(3.5 * 1024 * 1024)
export const DEFAULT_MAX_PAGES_PER_CHUNK = 50

export function getMaxChunkBytes(): number {
	const raw = process.env.AZURE_MAX_CHUNK_BYTES
	if (raw) {
		const n = Number(raw)
		if (Number.isFinite(n) && n > 0) return Math.floor(n)
	}
	return DEFAULT_MAX_CHUNK_BYTES
}

export function getMaxPagesPerChunk(): number {
	const raw = process.env.AZURE_MAX_CHUNK_PAGES
	if (raw) {
		const n = Number(raw)
		if (Number.isFinite(n) && n > 0) return Math.floor(n)
	}
	return DEFAULT_MAX_PAGES_PER_CHUNK
}

/** @deprecated use getMaxPagesPerChunk() — kept for tests */
export const MAX_PAGES_PER_CHUNK = DEFAULT_MAX_PAGES_PER_CHUNK
/** @deprecated use getMaxChunkBytes() */
export const AZURE_SAFE_BYTES = DEFAULT_MAX_CHUNK_BYTES

export interface PdfChunk {
	buffer: Buffer
	pageOffset: number
	pageCount: number
}

export interface ChunkOcrResult {
	id: string
	content: string
	confidence: number
	structuredData?: Record<string, any>
	extractedFields?: Record<string, any>
}

export type SplitProgress = {
	phase: 'load_start' | 'load_done' | 'chunk_start' | 'chunk_copied' | 'chunk_saved' | 'done'
	totalPages?: number
	chunkIndex?: number
	chunkTotal?: number
	pageOffset?: number
	pageCount?: number
	bytes?: number
	elapsedMs?: number
	maxBytes?: number
	maxPages?: number
}

export function shouldSplit(
	byteLength: number,
	pageCount: number,
	maxBytes: number = getMaxChunkBytes(),
	maxPages: number = getMaxPagesPerChunk(),
): boolean {
	return pageCount > maxPages || byteLength > maxBytes
}

export async function getPdfPageCount(buffer: Buffer): Promise<number> {
	const doc = await PDFDocument.load(buffer, { ignoreEncryption: true })
	return doc.getPageCount()
}

async function buildChunkBuffer(
	source: PDFDocument,
	start: number,
	pageCount: number,
): Promise<Buffer> {
	const pageIndices = Array.from({ length: pageCount }, (_, i) => start + i)
	const chunkDoc = await PDFDocument.create()
	const copied = await chunkDoc.copyPages(source, pageIndices)
	for (const page of copied) {
		chunkDoc.addPage(page)
	}
	return Buffer.from(await chunkDoc.save())
}

/**
 * Find largest pageCount in [1, maxPages] starting at `start` whose saved PDF
 * is <= maxBytes. Throws if a single page exceeds maxBytes.
 */
async function fitPageCount(
	source: PDFDocument,
	start: number,
	remaining: number,
	maxPages: number,
	maxBytes: number,
): Promise<{ pageCount: number; buffer: Buffer }> {
	const hardMax = Math.min(remaining, maxPages)
	let lo = 1
	let hi = hardMax
	let bestCount = 0
	let bestBuffer: Buffer | null = null

	// Probe upper bound first — empty pages are tiny; image-heavy docs need binary search
	while (lo <= hi) {
		const mid = Math.floor((lo + hi) / 2)
		const buffer = await buildChunkBuffer(source, start, mid)
		if (buffer.byteLength <= maxBytes) {
			bestCount = mid
			bestBuffer = buffer
			lo = mid + 1
		} else {
			hi = mid - 1
		}
	}

	if (!bestBuffer || bestCount < 1) {
		const single = await buildChunkBuffer(source, start, 1)
		throw new Error(
			`PDF page ${start + 1} is ${single.byteLength} bytes, over Azure max chunk size ${maxBytes} bytes. ` +
				`Raise AZURE_MAX_CHUNK_BYTES if on paid tier, or compress the PDF.`,
		)
	}

	return { pageCount: bestCount, buffer: bestBuffer }
}

export async function splitPdfByPages(
	buffer: Buffer,
	maxPages: number = getMaxPagesPerChunk(),
	onProgress?: (progress: SplitProgress) => void,
	maxBytes: number = getMaxChunkBytes(),
): Promise<PdfChunk[]> {
	const started = Date.now()
	onProgress?.({
		phase: 'load_start',
		elapsedMs: 0,
		maxBytes,
		maxPages,
	})

	const source = await PDFDocument.load(buffer, { ignoreEncryption: true })
	const totalPages = source.getPageCount()

	onProgress?.({
		phase: 'load_done',
		totalPages,
		elapsedMs: Date.now() - started,
		maxBytes,
		maxPages,
	})

	const chunks: PdfChunk[] = []
	let start = 0
	let chunkIndex = 0

	while (start < totalPages) {
		const remaining = totalPages - start
		onProgress?.({
			phase: 'chunk_start',
			totalPages,
			chunkIndex,
			pageOffset: start,
			elapsedMs: Date.now() - started,
			maxBytes,
			maxPages,
		})

		const { pageCount, buffer: chunkBuffer } = await fitPageCount(
			source,
			start,
			remaining,
			maxPages,
			maxBytes,
		)

		onProgress?.({
			phase: 'chunk_copied',
			totalPages,
			chunkIndex,
			pageOffset: start,
			pageCount,
			elapsedMs: Date.now() - started,
		})

		chunks.push({
			buffer: chunkBuffer,
			pageOffset: start,
			pageCount,
		})

		onProgress?.({
			phase: 'chunk_saved',
			totalPages,
			chunkIndex,
			pageOffset: start,
			pageCount,
			bytes: chunkBuffer.byteLength,
			elapsedMs: Date.now() - started,
		})

		start += pageCount
		chunkIndex += 1
	}

	onProgress?.({
		phase: 'done',
		totalPages,
		chunkTotal: chunks.length,
		elapsedMs: Date.now() - started,
	})

	return chunks
}

function remapPageNumber(value: unknown, pageOffset: number): unknown {
	if (typeof value === 'number') {
		return value + pageOffset
	}
	if (Array.isArray(value)) {
		return value.map((item) => remapPageNumber(item, pageOffset))
	}
	if (value && typeof value === 'object') {
		const obj = value as Record<string, unknown>
		const next: Record<string, unknown> = {}
		for (const [key, nested] of Object.entries(obj)) {
			if (key === 'pageNumber' && typeof nested === 'number') {
				next[key] = nested + pageOffset
			} else {
				next[key] = remapPageNumber(nested, pageOffset)
			}
		}
		return next
	}
	return value
}

export function reassembleOcrResults(
	chunkResults: ChunkOcrResult[],
	chunks: PdfChunk[],
	documentId: string,
): ChunkOcrResult {
	const contents: string[] = []
	let confidenceSum = 0
	let confidenceCount = 0
	const extractedFields: Record<string, any> = {}
	const structuredPages: any[] = []
	const structuredData: Record<string, any> = {}

	for (let i = 0; i < chunkResults.length; i++) {
		const result = chunkResults[i]
		if (!result) continue
		const offset = chunks[i]?.pageOffset ?? 0

		if (result.content) {
			contents.push(result.content)
		}
		if (typeof result.confidence === 'number') {
			confidenceSum += result.confidence
			confidenceCount += 1
		}
		if (result.extractedFields) {
			Object.assign(extractedFields, result.extractedFields)
		}
		if (result.structuredData) {
			const remapped = remapPageNumber(result.structuredData, offset) as Record<string, any>
			if (Array.isArray(remapped.pages)) {
				structuredPages.push(...remapped.pages)
			}
			for (const [key, value] of Object.entries(remapped)) {
				if (key === 'pages') continue
				structuredData[key] = value
			}
		}
	}

	if (structuredPages.length > 0) {
		structuredData.pages = structuredPages
	}

	return {
		id: documentId,
		content: contents.join('\n'),
		confidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
		structuredData,
		extractedFields,
	}
}
