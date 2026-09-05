export { createPdfExtractStrategy, resolvePdfExtractorName, fallbackToAzureOnError } from './factory'
export { mergeHybridPages } from './hybrid-merge'
export { extractPdfPages } from '../pdf-chunker'
export type { PdfExtractStrategy, PdfExtractorName } from './types'
