import type { OCRResult } from '../../../ocr'

export type PdfExtractorName = 'azure' | 'pymupdf4llm-hybrid'

export interface PdfExtractStrategy {
	readonly name: PdfExtractorName
	extract(documentId: number, fileBuffer: Buffer): Promise<OCRResult>
}

export type AzureAnalyzeFn = (
	documentId: number,
	fileBuffer: Buffer,
	meta?: { chunkIndex?: number; chunkTotal?: number; pageOffset?: number; pageCount?: number },
) => Promise<OCRResult>
