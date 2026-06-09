import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import { getFileExtension } from '@workspace/shared'
import { validateDocumentUpload } from '@workspace/shared'
import { isSupportedFileType, validateFileSize } from '@workspace/shared'
import { OCRService } from '@workspace/core'
import { documentRepository } from '@workspace/shared'
import { writeFile } from 'fs/promises'
import { authMiddleware } from './middleware/auth'

const app = new Elysia()
	.state({ startTime: Date.now(), apiKey: null })
	.use(cors())
	.get('/', () => ({ message: 'API is running !' }))
	.get('/health', () => ({
		status: 'ok',
		timestamp: new Date().toISOString()
	}))
	.onError(({ request }) => {
		console.log(`Incoming request: ${request.method} ${request.formData()}`)
	})
	.onBeforeHandle(authMiddleware)
	.post('/upload', async ({ body, store }) => {
		try {
			const { file, documentType } = body

			// Validate file
			if (!isSupportedFileType(file.name)) {
				return { error: 'Unsupported file type' }
			}

			if (!validateFileSize(file.size)) {
				return { error: 'File size too large (max 50MB)' }
			}

			// Validate document type
			const validation = validateDocumentUpload({
				filename: file.name,
				fileType: getFileExtension(file.name),
				fileSize: file.size,
				documentType
			})

			// // Save file temporarily (in production, use Azure or proper storage)
			const fileBuffer = Buffer.from(await file.arrayBuffer())
			const tempPath = `/tmp/${Date.now()}_${file.name}`
			await writeFile(tempPath, fileBuffer)

			const queueJob = new OCRService({ useQueue: true })

			const { documentId } = await queueJob.processDocument(fileBuffer, validation)

			// TODO: Add processing time to document
			const processingTimeMs = Date.now() - store.startTime

			let apiUsage = {
				apiKeyId: store.apiKey?.id,
				endPoint: 'upload',
				documentId,
				processingTimeMs,
			}

			return {
				success: true,
				documentId,
				processingTimeMs,
				message: 'Document uploaded and queued for processing'
			}
		} catch (error) {
			console.error('Upload error:', error, "*****")
			return { error: error }
		}
	}, {
		body: t.Object({
			file: t.File({
				error() {
					return {
						message: 'Please select a file to upload'
					}
				},
				format: "image/*",
				description: 'File must be a PDF, PNG, JPEG, TIFF, or TIFF file'
			}),
			documentType: t.String({
				error: 'Missing document type',
				description: 'Document type must be one of the following: judgment, court_order, contract, agreement, police_report, incident_report, witness_statement, affidavit, pleading, motion, brief, transcript, administrative_decision, regulatory_filing, other'
			})
		}),
		response: {
			400: t.Object({
				error: t.String(),
			}),
		}
	}
	)
	.get('/internal/documents/:id/extracted-text', async ({ params, set }) => {
		const documentId = Number(params.id)
		if (Number.isNaN(documentId)) {
			set.status = 400
			return { error: 'Invalid document id' }
		}

		const document = await documentRepository.findById(documentId)
		if (!document) {
			set.status = 404
			return { error: 'Document not found' }
		}

		const content = document.fullContent && typeof document.fullContent === 'object'
			? (document.fullContent as any).content || ''
			: ''

		const documentAny = document as any
		const corefSourceTextHash = documentAny.coreferenceResolvedContent?.source_text_hash || null

		return {
			documentId: document.id,
			text: content,
			textHash: documentAny.textHash || null,
			fileHash: documentAny.fileHash || null,
			coreferenceSourceTextHash: corefSourceTextHash,
			status: document.status,
		}
	})
	.post('/internal/documents/:id/coreference', async ({ params, body, set }) => {
		const documentId = Number(params.id)
		if (Number.isNaN(documentId)) {
			set.status = 400
			return { error: 'Invalid document id' }
		}

		const document = await documentRepository.findById(documentId)
		if (!document) {
			set.status = 404
			return { error: 'Document not found' }
		}

		const documentAny = document as any
		if (documentAny.textHash && documentAny.textHash !== body.source_text_hash) {
			set.status = 409
			return { error: 'Source text hash mismatch' }
		}

		await (documentRepository as any).updateCoreference(documentId, body)
		await documentRepository.addProcessingLog({
			documentId,
			action: 'coreference_completed',
			details: {
				model: body?.model,
				modelVersion: body?.model_version,
				inputCharCount: body?.input_char_count,
				processingTimeMs: body?.processing_time_ms,
			},
		})

		return { success: true }
	}, {
		body: t.Object({
			resolved_text: t.String(),
			clusters: t.Array(t.Any()),
			mentions: t.Array(t.Any()),
			model: t.String(),
			model_version: t.String(),
			source_text_hash: t.String(),
			processed_at: t.String(),
			processing_time_ms: t.Number(),
			input_char_count: t.Number(),
			chunked: t.Optional(t.Boolean()),
			chunk_size: t.Optional(t.Number()),
			chunk_count: t.Optional(t.Number()),
		}),
	})

const port = parseInt(process.env.PORT || '3001')
console.log(`Starting API server on port ${port}`)

try {
	app.listen(port)
	console.log(`API server running on port ${port}`)
} catch (error) {
	console.error('Failed to start server:', error)
	process.exit(1)
}
