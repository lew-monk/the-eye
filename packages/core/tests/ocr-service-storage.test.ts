import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockFindByFileHash = mock()
const mockCreate = mock()
const mockUpdateById = mock()
const mockAddProcessingLog = mock()
const mockFindById = mock()
const mockPutObject = mock()

mock.module('@workspace/shared', () => ({
	documentRepository: {
		findByFileHash: mockFindByFileHash,
		create: mockCreate,
		updateById: mockUpdateById,
		addProcessingLog: mockAddProcessingLog,
		findById: mockFindById,
	},
	validateDocumentUpload: (m: unknown) => m,
	getMimeType: (filename: string) =>
		filename.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
	getFileExtension: (filename: string) => {
		const i = filename.lastIndexOf('.')
		return i >= 0 ? filename.slice(i + 1).toLowerCase() : ''
	},
}))

import { OCRService } from '../src/ocr-service'
import { ObjectStorage } from '../src/services/storage'

describe('OCRService storage persistence', () => {
	const meta = {
		filename: 'judgment.pdf',
		fileType: 'pdf',
		fileSize: 100,
		documentType: 'judgment' as const,
	}
	const buffer = Buffer.from('%PDF-test')

	beforeEach(() => {
		mockFindByFileHash.mockReset()
		mockCreate.mockReset()
		mockUpdateById.mockReset()
		mockAddProcessingLog.mockReset()
		mockFindById.mockReset()
		mockPutObject.mockReset()

		mockFindByFileHash.mockResolvedValue(null)
		mockCreate.mockResolvedValue({
			id: 10,
			caseId: 3,
			filename: meta.filename,
			status: 'processing',
		})
		mockUpdateById.mockResolvedValue({})
		mockAddProcessingLog.mockResolvedValue(undefined)
		mockFindById.mockResolvedValue({ id: 10 })
		mockPutObject.mockResolvedValue(undefined)
	})

	function makeService(withStorage: boolean) {
		const storage = withStorage
			? new ObjectStorage({
					putObject: mockPutObject,
					getObject: mock(),
					getPresignedGetUrl: mock(),
					deleteObject: mock(),
				})
			: null

		const service = new OCRService({ useQueue: false, objectStorage: storage })
		// Avoid real Azure calls
		;(service as any).azureService = {
			processDocumentFromBuffer: mock().mockResolvedValue({
				structuredData: {},
				content: 'text',
				confidence: 0.9,
			}),
		}
		return service
	}

	it('persists original to object storage before OCR when storage is configured', async () => {
		const service = makeService(true)
		const result = await service.processDocument(buffer, meta, {}, 3)

		expect(result.documentId).toBe(10)
		expect(mockPutObject).toHaveBeenCalled()
		const [key, body, contentType] = mockPutObject.mock.calls[0]
		expect(key).toContain('documents/3/10/')
		expect(key).toEndWith('.pdf')
		expect(body).toEqual(buffer)
		expect(contentType).toBe('application/pdf')
		expect(mockUpdateById).toHaveBeenCalledWith(
			10,
			expect.objectContaining({
				storageKey: expect.stringContaining('documents/3/10/'),
				storageBucket: expect.any(String),
				contentType: 'application/pdf',
			}),
		)
	})

	it('skips storage put when storage is not configured (upload still works)', async () => {
		const service = makeService(false)
		const result = await service.processDocument(buffer, meta, {}, 3)

		expect(result.documentId).toBe(10)
		expect(mockPutObject).not.toHaveBeenCalled()
	})

	it('fails closed when putObject throws — marks document failed and does not run OCR', async () => {
		mockPutObject.mockRejectedValue(new Error('minio down'))
		const service = makeService(true)
		const azure = mock().mockResolvedValue({ content: 'x', confidence: 1, structuredData: {} })
		;(service as any).azureService = { processDocumentFromBuffer: azure }

		await expect(service.processDocument(buffer, meta, {}, 1)).rejects.toThrow('minio down')
		expect(azure).not.toHaveBeenCalled()
		expect(mockUpdateById).toHaveBeenCalledWith(
			10,
			expect.objectContaining({
				status: 'failed',
				errorMessage: expect.stringContaining('storage_failed'),
			}),
		)
	})

	it('backfills storage on dedup hit when legacy row lacks storageKey', async () => {
		mockFindByFileHash.mockResolvedValue({
			id: 99,
			status: 'completed',
			storageKey: null,
			caseId: 5,
		})
		const service = makeService(true)

		const result = await service.processDocument(buffer, meta, {}, 5)

		expect(result.documentId).toBe(99)
		expect(mockPutObject).toHaveBeenCalled()
		expect(mockCreate).not.toHaveBeenCalled()
	})

	it('does not put on dedup when storageKey already set', async () => {
		mockFindByFileHash.mockResolvedValue({
			id: 99,
			status: 'completed',
			storageKey: 'documents/5/99/hash.pdf',
			caseId: 5,
		})
		const service = makeService(true)

		const result = await service.processDocument(buffer, meta, {}, 5)

		expect(result.documentId).toBe(99)
		expect(mockPutObject).not.toHaveBeenCalled()
	})
})
