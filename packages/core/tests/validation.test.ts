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

	it('should accept files up to 200MB', () => {
		const result = validateDocumentUpload({
			filename: 'large.pdf',
			fileType: 'pdf',
			fileSize: 200 * 1024 * 1024,
			documentType: 'judgment',
		})
		expect(result.fileSize).toBe(200 * 1024 * 1024)
	})

	it('should accept 65MB image-heavy documents', () => {
		const result = validateDocumentUpload({
			filename: 'scanned.pdf',
			fileType: 'pdf',
			fileSize: 65 * 1024 * 1024,
			documentType: 'judgment',
		})
		expect(result.fileSize).toBe(65 * 1024 * 1024)
	})

	it('should reject files over 200MB', () => {
		expect(() => {
			validateDocumentUpload({
				filename: 'test.pdf',
				fileType: 'pdf',
				fileSize: 200 * 1024 * 1024 + 1,
				documentType: 'judgment',
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
