import { getFileExtension, isSupportedFileType, validateFileSize, validateDocumentUpload } from '@workspace/shared'
import { OCRService } from '@workspace/core'
import { writeFile } from 'fs/promises'

export abstract class UploadService {
	static async processUpload(file: File, documentType: string): Promise<{ documentId: number }> {
		if (!isSupportedFileType(file.name)) {
			throw new Error('Unsupported file type')
		}

		if (!validateFileSize(file.size)) {
			throw new Error('File size too large (max 50MB)')
		}

		const validation = validateDocumentUpload({
			filename: file.name,
			fileType: getFileExtension(file.name),
			fileSize: file.size,
			documentType,
		})

		const fileBuffer = Buffer.from(await file.arrayBuffer())
		// const tempPath = `/tmp/${Date.now()}_${file.name}`
		// await writeFile(tempPath, fileBuffer)

		const queueJob = new OCRService({ useQueue: true })
		return queueJob.processDocument(fileBuffer, validation)
	}
}
