import type { OCRResult } from '../../../ocr'
import { extractPdfPages } from '../pdf-chunker'
import { PipelineStage, logPipelineStage, pipelineLog } from '../../../utils/pipeline-log'
import type { PdfExtractStrategy } from './types'
import { mergeHybridPages } from './hybrid-merge'
import { runNativeExtract } from './native-extract'

function isPdfBuffer(buffer: Buffer): boolean {
	return buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF'
}

export class HybridPdfExtractStrategy implements PdfExtractStrategy {
	readonly name = 'pymupdf4llm-hybrid' as const

	constructor(
		private readonly analyzeDocument: (documentId: number, fileBuffer: Buffer) => Promise<OCRResult>,
		private readonly nativeExtract: typeof runNativeExtract = runNativeExtract,
	) {}

	async extract(documentId: number, fileBuffer: Buffer): Promise<OCRResult> {
		if (!isPdfBuffer(fileBuffer)) {
			await logPipelineStage(documentId, PipelineStage.OCR_HYBRID_FALLBACK, {
				reason: 'not_pdf',
				extractor: 'azure',
			})
			return this.analyzeDocument(documentId, fileBuffer)
		}

		await logPipelineStage(documentId, PipelineStage.OCR_HYBRID_STARTED, {
			bytes: fileBuffer.byteLength,
		})

		const native = await this.nativeExtract(fileBuffer)
		const ocrPages = native.pages.filter((p) => p.needsOcr).map((p) => p.pageIndex)

		await logPipelineStage(documentId, PipelineStage.OCR_HYBRID_NATIVE_DONE, {
			pageCount: native.pageCount,
			ocrPageCount: ocrPages.length,
			nativeExtractor: native.extractor,
		})

		const ocrByPage: Record<number, { content: string; confidence: number }> = {}
		if (ocrPages.length > 0) {
			await logPipelineStage(documentId, PipelineStage.OCR_HYBRID_OCR_PAGES, {
				pageIndices: ocrPages,
			})
			for (const pageIndex of ocrPages) {
				const pagePdf = await extractPdfPages(fileBuffer, [pageIndex])
				const result = await this.analyzeDocument(documentId, pagePdf)
				ocrByPage[pageIndex] = {
					content: result.content,
					confidence: result.confidence,
				}
				pipelineLog(documentId, 'hybrid_azure_page', {
					pageIndex,
					bytes: pagePdf.byteLength,
					contentLength: result.content.length,
				})
			}
		}

		const merged = mergeHybridPages(native.pages, ocrByPage)
		return {
			id: String(documentId),
			content: merged.content,
			confidence: merged.confidence,
			structuredData: {
				extractor: this.name,
				pageCount: native.pageCount,
				pages: merged.pages,
			},
			extractedFields: {},
		}
	}
}
