import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockFindById = mock()
const mockGetObject = mock()
const mockGetPresignedGetUrl = mock()

mock.module('@workspace/shared', () => ({
	documentRepository: {
		findById: mockFindById,
	},
}))

mock.module('@workspace/core', () => ({
	getObjectStorage: () => ({
		getObject: mockGetObject,
		getPresignedGetUrl: mockGetPresignedGetUrl,
	}),
	isObjectStorageConfigured: () => true,
}))

import { contentDispositionHeader, DocumentsService } from './service'

describe('contentDispositionHeader', () => {
	it('defaults to attachment and strips quotes', () => {
		expect(contentDispositionHeader('a"b.pdf')).toBe('attachment; filename="ab.pdf"')
	})

	it('supports inline for in-app preview', () => {
		expect(contentDispositionHeader('ruling.pdf', 'inline')).toBe(
			'inline; filename="ruling.pdf"',
		)
	})
})

describe('DocumentsService.getOriginalFile', () => {
	beforeEach(() => {
		mockFindById.mockReset()
		mockGetObject.mockReset()
		mockGetPresignedGetUrl.mockReset()
	})

	it('returns null when document does not exist', async () => {
		mockFindById.mockResolvedValue(null)
		const result = await DocumentsService.getOriginalFile(1)
		expect(result).toBeNull()
		expect(mockGetObject).not.toHaveBeenCalled()
	})

	it('returns null when document has no storageKey', async () => {
		mockFindById.mockResolvedValue({
			id: 1,
			filename: 'a.pdf',
			storageKey: null,
			contentType: null,
		})
		const result = await DocumentsService.getOriginalFile(1)
		expect(result).toBeNull()
		expect(mockGetObject).not.toHaveBeenCalled()
	})

	it('streams original bytes when storage key is present', async () => {
		mockFindById.mockResolvedValue({
			id: 5,
			filename: 'judgment.pdf',
			storageKey: 'documents/1/5/abc.pdf',
			contentType: 'application/pdf',
		})
		const body = Buffer.from('%PDF-1.4')
		mockGetObject.mockResolvedValue({
			body,
			contentType: 'application/pdf',
			contentLength: body.length,
		})

		const result = await DocumentsService.getOriginalFile(5)

		expect(result).not.toBeNull()
		expect(result!.filename).toBe('judgment.pdf')
		expect(result!.contentType).toBe('application/pdf')
		expect(result!.body).toEqual(body)
		expect(mockGetObject).toHaveBeenCalledWith('documents/1/5/abc.pdf')
	})

	it('uses injected storage mock when provided', async () => {
		mockFindById.mockResolvedValue({
			id: 2,
			filename: 'x.pdf',
			storageKey: 'key',
			contentType: null,
		})
		const injectedGet = mock().mockResolvedValue({
			body: Buffer.from('hi'),
			contentType: 'application/octet-stream',
		})

		const result = await DocumentsService.getOriginalFile(2, {
			getObject: injectedGet,
			putObject: mock(),
			getPresignedGetUrl: mock(),
			deleteObject: mock(),
		} as any)

		expect(result!.contentType).toBe('application/octet-stream')
		expect(injectedGet).toHaveBeenCalledWith('key')
	})
})

describe('DocumentsService.getPresignedFileUrl', () => {
	beforeEach(() => {
		mockFindById.mockReset()
		mockGetPresignedGetUrl.mockReset()
	})

	it('returns null without storage key', async () => {
		mockFindById.mockResolvedValue({ id: 1, storageKey: null, filename: 'a.pdf' })
		expect(await DocumentsService.getPresignedFileUrl(1)).toBeNull()
	})

	it('returns signed url from storage', async () => {
		mockFindById.mockResolvedValue({
			id: 3,
			storageKey: 'documents/unassigned/3/hash.pdf',
			filename: 'scan.pdf',
		})
		mockGetPresignedGetUrl.mockResolvedValue('https://minio/signed')

		const result = await DocumentsService.getPresignedFileUrl(3, 600)

		expect(result).toEqual({
			url: 'https://minio/signed',
			expiresSeconds: 600,
			filename: 'scan.pdf',
		})
		expect(mockGetPresignedGetUrl).toHaveBeenCalledWith('documents/unassigned/3/hash.pdf', 600)
	})
})
