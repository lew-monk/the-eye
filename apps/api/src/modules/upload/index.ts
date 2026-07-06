import { Elysia } from 'elysia'
import { UploadService } from './service'
import { UploadModel } from './model'
import { requirePermission } from '../../middleware/auth'

export const upload = new Elysia()
	.state({ startTime: Date.now(), apiKey: null })
	// .onBeforeHandle(requirePermission({
	// 	service: 'api',
	// 	resource: 'documents',
	// 	actions: ['create'],
	// }))
	.post(
		'/upload',
		async ({ body, store }) => {
			try {
				const { file, documentType } = body
				const { documentId } = await UploadService.processUpload(file, documentType)

				const processingTimeMs = Date.now() - (store.startTime as number)

				return {
					success: true,
					documentId,
					processingTimeMs,
					message: 'Document uploaded and queued for processing',
				}
			} catch (error) {
				console.error('Upload error:', error, '*****')
				return { error }
			}
		},
		{
			body: UploadModel.body,
			response: {
				400: UploadModel.response400,
			},
		},
	)
