import { Elysia, t } from 'elysia'
import { health } from './health'
import { admin } from './admin'
import { upload } from './upload'
import { internal } from './internal'
import { ChunksService } from './internal/chunks/service'
import { participantRepository } from '@workspace/shared'

export const modules = new Elysia()
	.use(health)
	.use(admin)
	.use(upload)
	.use(internal)
	.get(
		'/participants',
		async ({ query }) => {
			const result = await participantRepository.search({
				...(query.role ? { role: query.role } : {}),
				...(query.name ? { name: query.name } : {}),
				...(query.caseNumber ? { caseNumber: query.caseNumber } : {}),
				limit: query.limit ?? 20,
				offset: query.offset ?? 0,
			})
			return result
		},
		{
			query: t.Object({
				role: t.Optional(t.String()),
				name: t.Optional(t.String()),
				caseNumber: t.Optional(t.String()),
				limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
				offset: t.Optional(t.Numeric({ minimum: 0, default: 0 })),
			}),
		},
	)
	.get(
		'/cases/:id/participants',
		async ({ params, set }) => {
			const documentId = Number(params.id)
			if (Number.isNaN(documentId)) {
				set.status = 400
				return { error: 'Invalid case id' }
			}
			const data = await participantRepository.findByDocumentId(documentId)
			return { data }
		},
	)
	.get(
		'/cases/:id/participants/:participantId/context',
		async ({ params, set }) => {
			const documentId = Number(params.id)
			const participantId = Number(params.participantId)
			if (Number.isNaN(documentId) || Number.isNaN(participantId)) {
				set.status = 400
				return { error: 'Invalid case or participant id' }
			}
			const participant = await participantRepository.findById(participantId)
			if (!participant || participant.documentId !== documentId) {
				set.status = 404
				return { error: 'Participant not found in this case' }
			}
			return { data: participant }
		},
	)
	.get(
		'/cases/:id/similar',
		async ({ params, query, set }) => {
			const documentId = Number(params.id)
			if (Number.isNaN(documentId)) {
				set.status = 400
				return { error: 'Invalid document id' }
			}

			const result = await ChunksService.getSimilar(documentId, {
				limit: query.limit ?? 20,
				alpha: query.alpha ?? 0.4,
				beta: query.beta ?? 0.4,
				gamma: query.gamma ?? 0,
			})

			if (!result) {
				set.status = 404
				return { error: 'Document not found' }
			}

			return result
		},
		{
			query: t.Object({
				limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
				alpha: t.Optional(t.Numeric({ minimum: 0, maximum: 1, default: 0.4 })),
				beta: t.Optional(t.Numeric({ minimum: 0, maximum: 1, default: 0.4 })),
				gamma: t.Optional(t.Numeric({ minimum: 0, maximum: 1, default: 0 })),
			}),
		},
	)
