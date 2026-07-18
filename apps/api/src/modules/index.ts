import { Elysia, t } from 'elysia'
import { health } from './health'
import { admin } from './admin'
import { upload } from './upload'
import { internal } from './internal'
import { casesRouter } from './cases'
import { entitiesRouter } from './entities'
import { ChunksService } from './internal/chunks/service'
import { CasesService } from './cases/service'
import { participantRepository, chunkRepository, documentRepository } from '@workspace/shared'

export const modules = new Elysia()
	.use(health)
	.use(admin)
	.use(upload)
	.use(internal)
	.use(casesRouter)
	.use(entitiesRouter)
	.get(
		'/documents/stats',
		async () => {
			return documentRepository.getProcessingStats()
		},
	)
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
		'/participants/:id/mention-context',
		async ({ params, set }) => {
			const participantId = Number(params.id)
			if (Number.isNaN(participantId)) {
				set.status = 400
				return { error: 'Invalid participant id' }
			}
			const contexts = await CasesService.getMentionContexts(participantId)
			return { data: contexts }
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
	.get(
		'/documents/:id/chunks',
		async ({ params, set }) => {
			const documentId = Number(params.id)
			if (Number.isNaN(documentId)) {
				set.status = 400
				return { error: 'Invalid document id' }
			}
			const chunks = await chunkRepository.findByDocumentId(documentId)
			const sorted = chunks
				.filter((c) => c.positionWeight != null && c.text != null)
				.sort((a, b) => (b.positionWeight ?? 0) - (a.positionWeight ?? 0))
			return { data: sorted }
		},
	)
