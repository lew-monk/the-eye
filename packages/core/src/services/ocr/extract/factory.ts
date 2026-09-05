import { pipelineLog } from '../../../utils/pipeline-log'
import { AzurePdfExtractStrategy } from './azure-strategy'
import { HybridPdfExtractStrategy } from './hybrid-strategy'
import type { PdfExtractStrategy, PdfExtractorName } from './types'
import type { OCRResult } from '../../../ocr'

export function resolvePdfExtractorName(
	raw = process.env.PDF_EXTRACTOR,
): PdfExtractorName {
	const v = (raw || 'azure').trim().toLowerCase()
	if (v === 'pymupdf4llm-hybrid' || v === 'hybrid' || v === 'pymupdf') {
		return 'pymupdf4llm-hybrid'
	}
	return 'azure'
}

export function fallbackToAzureOnError(): boolean {
	const v = (process.env.PDF_EXTRACT_FALLBACK || 'azure').trim().toLowerCase()
	return v !== 'none' && v !== 'off' && v !== 'false'
}

type AnalyzeDocument = (documentId: number, fileBuffer: Buffer) => Promise<OCRResult>

export function createPdfExtractStrategy(analyzeDocument: AnalyzeDocument): PdfExtractStrategy {
	const name = resolvePdfExtractorName()
	const azure = new AzurePdfExtractStrategy(analyzeDocument)
	if (name === 'azure') return azure

	const hybrid = new HybridPdfExtractStrategy(analyzeDocument)
	if (!fallbackToAzureOnError()) return hybrid

	return {
		name: 'pymupdf4llm-hybrid',
		async extract(documentId, fileBuffer) {
			try {
				return await hybrid.extract(documentId, fileBuffer)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				pipelineLog(documentId, 'ocr_hybrid_fallback', {
					reason: message,
					extractor: 'azure',
				})
				return azure.extract(documentId, fileBuffer)
			}
		},
	}
}
