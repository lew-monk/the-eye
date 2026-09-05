import { getFileExtension, isSupportedFileType, validateFileSize, validateDocumentUpload } from '@workspace/shared'
import { getOCRService } from '@workspace/core'

export abstract class UploadService {
	static async processUpload(file: File, documentType: string, caseId?: number): Promise<{ documentId: number }> {
		const started = Date.now()
		console.log('[UPLOAD] received', {
			filename: file.name,
			size: file.size,
			documentType,
			caseId: caseId ?? null,
		})

		if (!isSupportedFileType(file.name)) {
			console.warn('[UPLOAD] rejected unsupported type', { filename: file.name })
			throw new Error('Unsupported file type')
		}

		if (!validateFileSize(file.size)) {
			console.warn('[UPLOAD] rejected oversized file', { filename: file.name, size: file.size })
			throw new Error('File size too large (max 200MB)')
		}

		const validation = validateDocumentUpload({
			filename: file.name,
			fileType: getFileExtension(file.name),
			fileSize: file.size,
			documentType,
		})

		const fileBuffer = Buffer.from(await file.arrayBuffer())
		console.log('[UPLOAD] buffered', {
			filename: file.name,
			bytes: fileBuffer.byteLength,
			ms: Date.now() - started,
		})

		const ocr = getOCRService({ useQueue: true })
		const result = await ocr.processDocument(fileBuffer, validation, {}, caseId)

		console.log('[UPLOAD] accepted', {
			documentId: result.documentId,
			filename: file.name,
			ms: Date.now() - started,
		})

		return result
	}
}
