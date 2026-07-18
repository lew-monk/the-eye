import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { MAX_UPLOAD_BYTES } from '@workspace/shared'

const mockProcessDocument = mock()

mock.module('@workspace/core', () => ({
	OCRService: class {
		processDocument = mockProcessDocument
	},
	getOCRService: () => ({
		processDocument: mockProcessDocument,
	}),
}))

import { UploadService } from './service'

function makeFile(name: string, size: number, type = 'application/pdf'): File {
	const bytes = new Uint8Array(Math.min(size, 64))
	const file = new File([bytes], name, { type })
	Object.defineProperty(file, 'size', { value: size })
	return file
}

describe('UploadService.processUpload', () => {
	beforeEach(() => {
		mockProcessDocument.mockReset()
		mockProcessDocument.mockResolvedValue({ documentId: 123 })
	})

	it('queues a supported file and returns documentId', async () => {
		const file = makeFile('judgment.pdf', 1024)

		const result = await UploadService.processUpload(file, 'judgment', 9)

		expect(result).toEqual({ documentId: 123 })
		expect(mockProcessDocument).toHaveBeenCalledTimes(1)
		const [, metadata, , caseId] = mockProcessDocument.mock.calls[0]
		expect(metadata.filename).toBe('judgment.pdf')
		expect(metadata.fileType).toBe('pdf')
		expect(metadata.fileSize).toBe(1024)
		expect(metadata.documentType).toBe('judgment')
		expect(caseId).toBe(9)
	})

	it('rejects unsupported file types', async () => {
		const file = makeFile('malware.exe', 1024, 'application/octet-stream')

		await expect(UploadService.processUpload(file, 'judgment')).rejects.toThrow('Unsupported file type')
		expect(mockProcessDocument).not.toHaveBeenCalled()
	})

	it('rejects files over 200MB', async () => {
		const file = makeFile('huge.pdf', MAX_UPLOAD_BYTES + 1)

		await expect(UploadService.processUpload(file, 'judgment')).rejects.toThrow('File size too large (max 200MB)')
		expect(mockProcessDocument).not.toHaveBeenCalled()
	})

	it('accepts files at the 200MB limit', async () => {
		const file = makeFile('edge.pdf', MAX_UPLOAD_BYTES)

		const result = await UploadService.processUpload(file, 'contract')

		expect(result).toEqual({ documentId: 123 })
		expect(mockProcessDocument).toHaveBeenCalledTimes(1)
	})
})
