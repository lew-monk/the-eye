import { describe, it, expect } from 'bun:test'
import { validateDocumentUpload, validateProcessingOptions } from '@workspace/shared'
import { getConfidenceThreshold } from '../src/utils/confidence'

describe('Validation', () => {
	it('should validate document upload', () => {
		const input = {
			filename: 'test.pdf',
			fileType: 'pdf',
			fileSize: 1024000,
			documentType: 'judgment'
		}

		const result = validateDocumentUpload(input)
		expect(result.filename).toBe('test.pdf')
		expect(result.documentType).toBe('judgment')
	})

	it('should validate processing options', () => {
		const input = {
			extractFullContent: true,
			customModelId: 'custom-model-1'
		}

		const result = validateProcessingOptions(input)
		expect(result.extractFullContent).toBe(true)
		expect(result.customModelId).toBe('custom-model-1')
	})

	it('should reject invalid file types', () => {
		expect(() => {
			validateDocumentUpload({
				filename: 'test.exe',
				fileType: 'exe',
				fileSize: 1024,
				documentType: 'judgment'
			})
		}).toThrow()
	})

	it('should reject files that are too large', () => {
		expect(() => {
			validateDocumentUpload({
				filename: 'test.pdf',
				fileType: 'pdf',
				fileSize: 100 * 1024 * 1024, // 100MB
				documentType: 'judgment'
			})
		}).toThrow()
	})
})

describe('Confidence Thresholds', () => {
	it('should return correct thresholds for different document types', () => {
		expect(getConfidenceThreshold('judgment')).toBe(0.8)
		expect(getConfidenceThreshold('contract')).toBe(0.75)
		expect(getConfidenceThreshold('police_report')).toBe(0.7)
		expect(getConfidenceThreshold('unknown')).toBe(0.7)
	})
})
