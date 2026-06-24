import { Elysia } from 'elysia'
import { CoreferenceService } from './service'
import { CoreferenceModel } from './model'

import { requirePermission } from '../../../middleware/auth'

export const coreference = new Elysia()
	.get('/:id/extracted-text', async ({ params, set }) => {
		const documentId = Number(params.id)
		if (Number.isNaN(documentId)) {
			set.status = 400
			return { error: 'Invalid document id' }
		}

		const result = await CoreferenceService.getExtractedText(documentId)
		if (!result) {
			set.status = 404
			return { error: 'Document not found' }
		}

		return result
	}, {
		beforeHandle: [requirePermission({ service: 'api', resource: 'documents', actions: ['read'] })],
	})
	.post(
		'/:id/coreference',
		async ({ params, body, set }) => {
			const documentId = Number(params.id)
			if (Number.isNaN(documentId)) {
				set.status = 400
				return { error: 'Invalid document id' }
			}

			const result = await CoreferenceService.storeCoreference(documentId, body)

			if (!result) {
				set.status = 404
				return { error: 'Document not found' }
			}

			if ('hashMismatch' in result) {
				set.status = 409
				return { error: 'Source text hash mismatch' }
			}

			return result
		},
		{
			beforeHandle: [requirePermission({ service: 'api', resource: 'documents', actions: ['create'] })],
			body: CoreferenceModel.body,
		},
	)
