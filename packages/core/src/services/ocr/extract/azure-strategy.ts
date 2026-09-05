import type { OCRResult } from '../../../ocr'
import { PipelineStage, logPipelineStage } from '../../../utils/pipeline-log'
import type { PdfExtractStrategy } from './types'

export class AzurePdfExtractStrategy implements PdfExtractStrategy {
	readonly name = 'azure' as const

	constructor(
		private readonly analyzeDocument: (documentId: number, fileBuffer: Buffer) => Promise<OCRResult>,
	) {}

	async extract(documentId: number, fileBuffer: Buffer): Promise<OCRResult> {
		await logPipelineStage(documentId, PipelineStage.OCR_INSPECTING, {
			extractor: this.name,
		})
		const result = await this.analyzeDocument(documentId, fileBuffer)
		return {
			...result,
			structuredData: {
				...(result.structuredData || {}),
				extractor: this.name,
			},
		}
	}
}
