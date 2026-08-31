import { Elysia, t } from 'elysia'
import { EntityService } from './service'

export const entitiesRouter = new Elysia({ prefix: '/entities' })
	.get(
		'/network',
		async ({ query }) => {
			const network = await EntityService.getCoOccurrenceNetwork(query.limit ?? 30)
			return { data: network }
		},
		{
			query: t.Object({
				limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 30 })),
			}),
		},
	)
	.get('/:name/dossier', async ({ params, set }) => {
		const name = decodeURIComponent(params.name)
		const dossier = await EntityService.getDossier(name)
		if (!dossier) {
			set.status = 404
			return { error: 'Entity not found' }
		}
		return { data: dossier }
	})
	.get('/:name/confidence', async ({ params, set }) => {
		const name = decodeURIComponent(params.name)
		const confidence = await EntityService.getConfidence(name)
		if (confidence.roles.length === 0) {
			set.status = 404
			return { error: 'Entity not found' }
		}
		return { data: confidence }
	})
