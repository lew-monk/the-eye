import { Elysia, t } from 'elysia'
import { DocumentsService } from './service'
import { requirePermission } from '../../../middleware/auth'

export const documents = new Elysia()
	.post(
		'/:id/reprocess',
		async ({ params, set }) => {
			const documentId = Number(params.id)
			if (Number.isNaN(documentId)) {
				set.status = 400
				return { error: 'Invalid document id' }
			}

			const result = await DocumentsService.reprocess(documentId)
			if (!result) {
				set.status = 404
				return { error: 'Document not found' }
			}

			return result
		},
		{
			beforeHandle: [requirePermission({ service: 'api', resource: 'documents', actions: ['create'] })],
		},
	)
