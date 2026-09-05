import type { ObjectStorageDriver } from './types'
import { getFileExtension } from '@workspace/shared'

export class ObjectStorage {
	constructor(private driver: ObjectStorageDriver) {}

	putObject(key: string, body: Buffer, contentType: string): Promise<void> {
		return this.driver.putObject(key, body, contentType)
	}

	getObject(key: string) {
		return this.driver.getObject(key)
	}

	getPresignedGetUrl(key: string, expiresSeconds: number): Promise<string> {
		return this.driver.getPresignedGetUrl(key, expiresSeconds)
	}

	deleteObject(key: string): Promise<void> {
		return this.driver.deleteObject(key)
	}
}

export function buildDocumentStorageKey(params: {
	caseId?: number | null
	documentId: number
	fileHash: string
	filename: string
}): string {
	const caseSegment = params.caseId != null ? String(params.caseId) : 'unassigned'
	const ext = getFileExtension(params.filename)
	const suffix = ext ? `.${ext}` : ''
	return `documents/${caseSegment}/${params.documentId}/${params.fileHash}${suffix}`
}
