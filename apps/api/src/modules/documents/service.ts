import { documentRepository } from '@workspace/shared'
import {
	getObjectStorage,
	isObjectStorageConfigured,
	type ObjectStorage,
} from '@workspace/core'
import type { Readable } from 'stream'

export interface DocumentFileResult {
	body: Readable | Buffer
	filename: string
	contentType: string
	contentLength?: number
}

export abstract class DocumentsService {
	static async getOriginalFile(
		documentId: number,
		storage?: ObjectStorage | null,
	): Promise<DocumentFileResult | null> {
		const doc = await documentRepository.findById(documentId)
		if (!doc) return null
		if (!doc.storageKey) return null

		const objectStorage =
			storage !== undefined
				? storage
				: isObjectStorageConfigured()
					? getObjectStorage()
					: null

		if (!objectStorage) {
			throw new Error('Object storage is not configured')
		}

		const object = await objectStorage.getObject(doc.storageKey)
		return {
			body: object.body,
			filename: doc.filename,
			contentType: doc.contentType || object.contentType || 'application/octet-stream',
			contentLength: object.contentLength,
		}
	}

	static async getPresignedFileUrl(
		documentId: number,
		expiresSeconds = 900,
		storage?: ObjectStorage | null,
	): Promise<{ url: string; expiresSeconds: number; filename: string } | null> {
		const doc = await documentRepository.findById(documentId)
		if (!doc) return null
		if (!doc.storageKey) return null

		const objectStorage =
			storage !== undefined
				? storage
				: isObjectStorageConfigured()
					? getObjectStorage()
					: null

		if (!objectStorage) {
			throw new Error('Object storage is not configured')
		}

		const url = await objectStorage.getPresignedGetUrl(doc.storageKey, expiresSeconds)
		return {
			url,
			expiresSeconds,
			filename: doc.filename,
		}
	}
}
