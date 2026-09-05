import { describe, expect, it, afterEach } from 'bun:test'
import { fallbackToAzureOnError, resolvePdfExtractorName } from './factory'

const ORIGINAL = process.env.PDF_EXTRACTOR
const ORIGINAL_FB = process.env.PDF_EXTRACT_FALLBACK

afterEach(() => {
	if (ORIGINAL === undefined) delete process.env.PDF_EXTRACTOR
	else process.env.PDF_EXTRACTOR = ORIGINAL
	if (ORIGINAL_FB === undefined) delete process.env.PDF_EXTRACT_FALLBACK
	else process.env.PDF_EXTRACT_FALLBACK = ORIGINAL_FB
})

describe('resolvePdfExtractorName', () => {
	it('defaults to azure for backwards compatibility', () => {
		delete process.env.PDF_EXTRACTOR
		expect(resolvePdfExtractorName()).toBe('azure')
	})

	it('accepts pymupdf4llm-hybrid aliases', () => {
		expect(resolvePdfExtractorName('hybrid')).toBe('pymupdf4llm-hybrid')
		expect(resolvePdfExtractorName('pymupdf')).toBe('pymupdf4llm-hybrid')
		expect(resolvePdfExtractorName('pymupdf4llm-hybrid')).toBe('pymupdf4llm-hybrid')
	})
})

describe('fallbackToAzureOnError', () => {
	it('defaults to true so hybrid can revert at runtime', () => {
		delete process.env.PDF_EXTRACT_FALLBACK
		expect(fallbackToAzureOnError()).toBe(true)
	})

	it('can be disabled', () => {
		process.env.PDF_EXTRACT_FALLBACK = 'none'
		expect(fallbackToAzureOnError()).toBe(false)
	})
})
