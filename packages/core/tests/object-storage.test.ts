import { describe, it, expect, mock, beforeEach } from 'bun:test'
import {
	ObjectStorage,
	buildDocumentStorageKey,
	createObjectStorageDriver,
	isObjectStorageConfigured,
	resetObjectStorageForTests,
	S3Driver,
} from '../src/services/storage'

describe('buildDocumentStorageKey', () => {
	it('uses case id when present', () => {
		expect(
			buildDocumentStorageKey({
				caseId: 42,
				documentId: 7,
				fileHash: 'abc123',
				filename: 'judgment.pdf',
			}),
		).toBe('documents/42/7/abc123.pdf')
	})

	it('uses unassigned when case id is null', () => {
		expect(
			buildDocumentStorageKey({
				caseId: null,
				documentId: 1,
				fileHash: 'deadbeef',
				filename: 'photo.PNG',
			}),
		).toBe('documents/unassigned/1/deadbeef.png')
	})

	it('handles missing extension', () => {
		expect(
			buildDocumentStorageKey({
				caseId: 1,
				documentId: 2,
				fileHash: 'h',
				filename: 'README',
			}),
		).toBe('documents/1/2/h')
	})
})

describe('ObjectStorage facade', () => {
	it('delegates put/get/presign/delete to the driver', async () => {
		const putObject = mock().mockResolvedValue(undefined)
		const getObject = mock().mockResolvedValue({ body: Buffer.from('x') })
		const getPresignedGetUrl = mock().mockResolvedValue('https://signed')
		const deleteObject = mock().mockResolvedValue(undefined)

		const storage = new ObjectStorage({
			putObject,
			getObject,
			getPresignedGetUrl,
			deleteObject,
		})

		await storage.putObject('k', Buffer.from('data'), 'application/pdf')
		await storage.getObject('k')
		await storage.getPresignedGetUrl('k', 120)
		await storage.deleteObject('k')

		expect(putObject).toHaveBeenCalledWith('k', Buffer.from('data'), 'application/pdf')
		expect(getObject).toHaveBeenCalledWith('k')
		expect(getPresignedGetUrl).toHaveBeenCalledWith('k', 120)
		expect(deleteObject).toHaveBeenCalledWith('k')
	})
})

describe('createObjectStorageDriver', () => {
	beforeEach(() => {
		resetObjectStorageForTests()
	})

	it('creates S3Driver for minio provider', () => {
		const driver = createObjectStorageDriver({
			STORAGE_PROVIDER: 'minio',
			S3_ENDPOINT: 'http://localhost:9000',
			S3_REGION: 'us-east-1',
			S3_ACCESS_KEY_ID: 'minioadmin',
			S3_SECRET_ACCESS_KEY: 'minioadmin',
			S3_BUCKET: 'the-eye-documents',
			S3_FORCE_PATH_STYLE: 'true',
		})
		expect(driver).toBeInstanceOf(S3Driver)
	})

	it('creates S3Driver for s3 provider', () => {
		const driver = createObjectStorageDriver({
			STORAGE_PROVIDER: 's3',
			S3_REGION: 'eu-west-1',
			S3_ACCESS_KEY_ID: 'ak',
			S3_SECRET_ACCESS_KEY: 'sk',
			S3_BUCKET: 'prod-bucket',
		})
		expect(driver).toBeInstanceOf(S3Driver)
	})

	it('throws for azure until implemented', () => {
		expect(() =>
			createObjectStorageDriver({
				STORAGE_PROVIDER: 'azure',
			}),
		).toThrow(/not implemented/)
	})

	it('throws for unknown provider', () => {
		expect(() =>
			createObjectStorageDriver({
				STORAGE_PROVIDER: 'gcs',
			}),
		).toThrow(/Unknown STORAGE_PROVIDER/)
	})

	it('throws when S3 credentials missing', () => {
		expect(() =>
			createObjectStorageDriver({
				STORAGE_PROVIDER: 'minio',
				S3_BUCKET: 'b',
			}),
		).toThrow(/S3_ACCESS_KEY_ID/)
	})
})

describe('isObjectStorageConfigured', () => {
	it('returns false when provider unset or off', () => {
		expect(isObjectStorageConfigured({})).toBe(false)
		expect(isObjectStorageConfigured({ STORAGE_PROVIDER: 'none' })).toBe(false)
		expect(isObjectStorageConfigured({ STORAGE_PROVIDER: 'off' })).toBe(false)
	})

	it('returns true when minio credentials present', () => {
		expect(
			isObjectStorageConfigured({
				STORAGE_PROVIDER: 'minio',
				S3_ACCESS_KEY_ID: 'a',
				S3_SECRET_ACCESS_KEY: 'b',
				S3_BUCKET: 'bucket',
			}),
		).toBe(true)
	})

	it('returns false when bucket missing', () => {
		expect(
			isObjectStorageConfigured({
				STORAGE_PROVIDER: 's3',
				S3_ACCESS_KEY_ID: 'a',
				S3_SECRET_ACCESS_KEY: 'b',
			}),
		).toBe(false)
	})
})
