import type { Readable } from 'stream'

export interface ObjectStorageDriver {
	putObject(key: string, body: Buffer, contentType: string): Promise<void>
	getObject(key: string): Promise<{
		body: Readable | Buffer
		contentType?: string
		contentLength?: number
	}>
	getPresignedGetUrl(key: string, expiresSeconds: number): Promise<string>
	deleteObject(key: string): Promise<void>
}

export interface S3DriverConfig {
	endpoint?: string
	region: string
	accessKeyId: string
	secretAccessKey: string
	bucket: string
	forcePathStyle?: boolean
}
