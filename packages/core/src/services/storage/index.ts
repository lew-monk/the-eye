import { ObjectStorage } from './object-storage'
import { S3Driver } from './drivers/s3-driver'
import type { ObjectStorageDriver } from './types'

export type { ObjectStorageDriver, S3DriverConfig } from './types'
export { ObjectStorage, buildDocumentStorageKey } from './object-storage'
export { S3Driver } from './drivers/s3-driver'

export function createObjectStorageDriver(
	env: NodeJS.ProcessEnv = process.env,
): ObjectStorageDriver {
	const provider = (env.STORAGE_PROVIDER ?? 'minio').toLowerCase()

	switch (provider) {
		case 'minio':
		case 's3': {
			const accessKeyId = env.S3_ACCESS_KEY_ID
			const secretAccessKey = env.S3_SECRET_ACCESS_KEY
			const bucket = env.S3_BUCKET
			if (!accessKeyId || !secretAccessKey || !bucket) {
				throw new Error(
					'S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET are required when STORAGE_PROVIDER is minio or s3',
				)
			}
			return new S3Driver({
				endpoint: env.S3_ENDPOINT,
				region: env.S3_REGION ?? 'us-east-1',
				accessKeyId,
				secretAccessKey,
				bucket,
				forcePathStyle:
					env.S3_FORCE_PATH_STYLE === 'true' ||
					provider === 'minio' ||
					env.S3_FORCE_PATH_STYLE === '1',
			})
		}
		case 'azure':
			throw new Error(
				'Azure Blob driver is not implemented yet. Set STORAGE_PROVIDER to minio or s3.',
			)
		default:
			throw new Error(`Unknown STORAGE_PROVIDER: ${provider}`)
	}
}

let instance: ObjectStorage | null = null

export function getObjectStorage(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
	if (!instance) {
		instance = new ObjectStorage(createObjectStorageDriver(env))
	}
	return instance
}

/** Test helper — reset singleton between tests. */
export function resetObjectStorageForTests(): void {
	instance = null
}

export function isObjectStorageConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
	const provider = (env.STORAGE_PROVIDER ?? '').toLowerCase()
	if (!provider || provider === 'none' || provider === 'off') return false
	if (provider === 'minio' || provider === 's3') {
		return Boolean(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET)
	}
	return false
}
