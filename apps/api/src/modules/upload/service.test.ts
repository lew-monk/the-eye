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

	it('passes correct fileType for uppercase extension', async () => {
		const file = makeFile('JUDGMENT.PDF', 512)
		await UploadService.processUpload(file, 'judgment')
		const [, metadata] = mockProcessDocument.mock.calls[0]
		expect(metadata.fileType).toBe('pdf')
	})

	it('passes correct fileType for multi-dot filename', async () => {
		const file = makeFile('report.final.pdf', 512)
		await UploadService.processUpload(file, 'other')
		const [, metadata] = mockProcessDocument.mock.calls[0]
		expect(metadata.fileType).toBe('pdf')
	})

	it('handles optional caseId as undefined when omitted', async () => {
		const file = makeFile('doc.pdf', 512)
		await UploadService.processUpload(file, 'judgment')
		const [, , , caseId] = mockProcessDocument.mock.calls[0]
		expect(caseId).toBeUndefined()
	})

	it('rejects unsupported file types', async () => {
		const file = makeFile('malware.exe', 1024, 'application/octet-stream')
		await expect(UploadService.processUpload(file, 'judgment')).rejects.toThrow('Unsupported file type')
		expect(mockProcessDocument).not.toHaveBeenCalled()
	})

	it('rejects files with no extension', async () => {
		const file = makeFile('README', 1024, 'application/octet-stream')
		await expect(UploadService.processUpload(file, 'judgment')).rejects.toThrow('Unsupported file type')
	})

	it('rejects files with unsupported image extension', async () => {
		const file = makeFile('photo.gif', 1024, 'image/gif')
		await expect(UploadService.processUpload(file, 'judgment')).rejects.toThrow('Unsupported file type')
	})

	it('rejects files over 200MB', async () => {
		const file = makeFile('huge.pdf', MAX_UPLOAD_BYTES + 1)
		await expect(UploadService.processUpload(file, 'judgment')).rejects.toThrow('File size too large (max 200MB)')
		expect(mockProcessDocument).not.toHaveBeenCalled()
	})

	it('rejects files exactly 1 byte over limit', async () => {
		const file = makeFile('just-over.pdf', MAX_UPLOAD_BYTES + 1)
		await expect(UploadService.processUpload(file, 'judgment')).rejects.toThrow('File size too large')
	})

	it('accepts files at the 200MB limit', async () => {
		const file = makeFile('edge.pdf', MAX_UPLOAD_BYTES)
		const result = await UploadService.processUpload(file, 'contract')
		expect(result).toEqual({ documentId: 123 })
		expect(mockProcessDocument).toHaveBeenCalledTimes(1)
	})

	it('accepts 0-byte file', async () => {
		const file = makeFile('empty.pdf', 0)
		const result = await UploadService.processUpload(file, 'other')
		expect(result).toEqual({ documentId: 123 })
	})

	it('handles supported tiff files', async () => {
		const file = makeFile('scan.tiff', 50000, 'image/tiff')
		const result = await UploadService.processUpload(file, 'other')
		expect(result.documentId).toBe(123)
	})

	it('handles supported png files', async () => {
		const file = makeFile('screenshot.png', 50000, 'image/png')
		const result = await UploadService.processUpload(file, 'other')
		expect(result.documentId).toBe(123)
	})

	it('handles supported jpeg files', async () => {
		const file = makeFile('photo.jpeg', 50000, 'image/jpeg')
		const result = await UploadService.processUpload(file, 'other')
		expect(result.documentId).toBe(123)
	})

	it('forwards OCR errors to caller', async () => {
		mockProcessDocument.mockRejectedValue(new Error('OCR failure'))
		const file = makeFile('doc.pdf', 1024)
		await expect(UploadService.processUpload(file, 'judgment')).rejects.toThrow('OCR failure')
	})

	it('supports documentType with hyphens and underscores', async () => {
		const file = makeFile('doc.pdf', 512)
		await UploadService.processUpload(file, 'witness_statement')
		const [, metadata] = mockProcessDocument.mock.calls[0]
		expect(metadata.documentType).toBe('witness_statement')
	})
})
