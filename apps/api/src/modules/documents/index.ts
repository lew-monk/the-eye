import { Elysia, t } from 'elysia'
import { DocumentsService } from './service'

function contentDisposition(filename: string): string {
	const safe = filename.replace(/"/g, '')
	return `attachment; filename="${safe}"`
}

async function bodyToBuffer(body: Buffer | NodeJS.ReadableStream): Promise<Buffer> {
	if (Buffer.isBuffer(body)) return body
	const chunks: Buffer[] = []
	for await (const chunk of body) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
	}
	return Buffer.concat(chunks)
}

export const documentsRouter = new Elysia({ prefix: '/documents' })
	.get('/:id/file', async ({ params, set }) => {
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
			set.headers['Content-Type'] = file.contentType
			set.headers['Content-Disposition'] = contentDisposition(file.filename)
			if (file.contentLength != null) {
				set.headers['Content-Length'] = String(file.contentLength)
			} else {
				set.headers['Content-Length'] = String(buffer.length)
			}
			return new Response(buffer, {
				headers: {
					'Content-Type': file.contentType,
					'Content-Disposition': contentDisposition(file.filename),
					'Content-Length': String(buffer.length),
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
	})
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
