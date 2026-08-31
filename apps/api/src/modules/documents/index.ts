import { Elysia, t } from 'elysia'
import { contentDispositionHeader, DocumentsService } from './service'
import { requireServiceToken } from '../../middleware/auth'

async function bodyToBuffer(body: Buffer | NodeJS.ReadableStream): Promise<Buffer> {
	if (Buffer.isBuffer(body)) return body
	const chunks: Buffer[] = []
	for await (const chunk of body) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
	}
	return Buffer.concat(chunks)
}

export const documentsRouter = new Elysia({ prefix: '/documents' })
	.onBeforeHandle(requireServiceToken())
	.get(
		'/:id/file',
		async ({ params, query, set }) => {
			const documentId = Number(params.id)
			if (Number.isNaN(documentId)) {
				set.status = 400
				return { error: 'Invalid document id' }
			}

			try {
				const file = await DocumentsService.getOriginalFile(documentId)
				if (!file) {
					set.status = 404
					return { error: 'Document file not found' }
				}

				const buffer = await bodyToBuffer(file.body as Buffer | NodeJS.ReadableStream)
				const bytes = new Uint8Array(buffer)
				const disposition = contentDispositionHeader(
					file.filename,
					query.disposition === 'inline' ? 'inline' : 'attachment',
				)
				return new Response(bytes, {
					headers: {
						'Content-Type': file.contentType,
						'Content-Disposition': disposition,
						'Content-Length': String(bytes.byteLength),
						'Cache-Control': 'private, max-age=60',
						'X-Content-Type-Options': 'nosniff',
					},
				})
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				if (message.includes('not configured')) {
					set.status = 503
					return { error: 'Object storage is not configured' }
				}
				console.error('Document file download error:', error)
				set.status = 500
				return { error: message }
			}
		},
		{
			query: t.Object({
				disposition: t.Optional(t.Union([t.Literal('inline'), t.Literal('attachment')])),
			}),
		},
	)
	.get(
		'/:id/file-url',
		async ({ params, query, set }) => {
			const documentId = Number(params.id)
			if (Number.isNaN(documentId)) {
				set.status = 400
				return { error: 'Invalid document id' }
			}

			try {
				const result = await DocumentsService.getPresignedFileUrl(
					documentId,
					query.expires ?? 900,
				)
				if (!result) {
					set.status = 404
					return { error: 'Document file not found' }
				}
				return { data: result }
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				if (message.includes('not configured')) {
					set.status = 503
					return { error: 'Object storage is not configured' }
				}
				console.error('Document file-url error:', error)
				set.status = 500
				return { error: message }
			}
		},
		{
			query: t.Object({
				expires: t.Optional(t.Numeric({ minimum: 60, maximum: 3600, default: 900 })),
			}),
		},
	)
