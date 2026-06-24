import { Elysia } from 'elysia'
import { ParticipantsService } from './service'
import { ParticipantModel } from './model'
import { requirePermission } from '../../../middleware/auth'

export const participants = new Elysia().post(
	'/:id/participants',
	async ({ params, body, set }) => {
		const documentId = Number(params.id)
		if (Number.isNaN(documentId)) {
			set.status = 400
			return { error: 'Invalid document id' }
		}

		const result = await ParticipantsService.store(documentId, body.participants, body.extractionVersion)

		if (!result) {
			set.status = 404
			return { error: 'Document not found' }
		}

		return { success: true, count: result.count }
	},
	{
		beforeHandle: [requirePermission({ service: 'api', resource: 'documents', actions: ['create'] })],
		body: ParticipantModel.body,
	},
)
