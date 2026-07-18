import { Elysia } from 'elysia'
import { EntityService } from './service'

export const entitiesRouter = new Elysia({ prefix: '/entities' })
	.get('/:name/dossier', async ({ params, set }) => {
		const name = decodeURIComponent(params.name)
		const dossier = await EntityService.getDossier(name)
		if (!dossier) {
			set.status = 404
			return { error: 'Entity not found' }
		}
		return { data: dossier }
	})
