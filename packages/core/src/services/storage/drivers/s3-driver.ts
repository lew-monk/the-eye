import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Readable } from 'stream'
import type { ObjectStorageDriver, S3DriverConfig } from '../types'

export class S3Driver implements ObjectStorageDriver {
	private client: S3Client
	private bucket: string

	constructor(config: S3DriverConfig) {
		this.bucket = config.bucket
		this.client = new S3Client({
			region: config.region,
			...(config.endpoint ? { endpoint: config.endpoint } : {}),
			forcePathStyle: config.forcePathStyle ?? false,
			credentials: {
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey,
			},
		})
	}

	async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: key,
				Body: body,
				ContentType: contentType,
			}),
		)
	}

	async getObject(key: string): Promise<{
		body: Readable | Buffer
		contentType?: string
		contentLength?: number
	}> {
		const result = await this.client.send(
			new GetObjectCommand({
				Bucket: this.bucket,
				Key: key,
			}),
		)

		if (!result.Body) {
			throw new Error(`Object not found: ${key}`)
		}

		const body = result.Body as Readable
		return {
			body,
			contentType: result.ContentType,
			contentLength: result.ContentLength,
		}
	}

	async getPresignedGetUrl(key: string, expiresSeconds: number): Promise<string> {
		const command = new GetObjectCommand({
			Bucket: this.bucket,
			Key: key,
		})
		return getSignedUrl(this.client, command, { expiresIn: expiresSeconds })
	}

	async deleteObject(key: string): Promise<void> {
		await this.client.send(
			new DeleteObjectCommand({
				Bucket: this.bucket,
				Key: key,
			}),
		)
	}
}
