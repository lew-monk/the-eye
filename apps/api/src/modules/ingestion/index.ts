import { Elysia } from 'elysia'
import { IngestionModel } from './model'
import { IngestionService } from './service'
import { streamJobEvents } from './worker-events'
import { getQueuesStatus } from './queues'
import { ingestionCollections } from '@workspace/ingestion'
import { requireServiceToken } from '../../middleware/auth'

// BFF pattern (same as documents module): the web app checks the user
// session and forwards the shared service token as x-api-key. Per-user
// API keys remain for external consumers via requirePermission routes.
const serviceAuth = requireServiceToken()

export const ingestionRouter = new Elysia({ prefix: '/ingestion' })
	.post(
		'/jobs',
		async ({ body, set }) => {
			try {
				const job = await IngestionService.createJob({
					source: body.source,
					root: body.root,
					...(body.collection ? { collection: body.collection } : {}),
				})
				set.status = 201
				return { data: job }
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				if (
					message.includes('not a directory') ||
					message.includes('Unsupported source') ||
					message.includes('Invalid collection')
				) {
					set.status = 400
				} else {
					set.status = 500
				}
				return { error: message }
			}
		},
		{ beforeHandle: serviceAuth, body: IngestionModel.createJobBody },
	)
	.get('/queues/status', async () => ({ data: await getQueuesStatus(ingestionCollections(process.env)) }), {
		beforeHandle: serviceAuth,
	})
	.get('/jobs', async () => ({ data: await IngestionService.listJobs() }), {
		beforeHandle: serviceAuth,
	})
	.get(
		'/jobs/:id',
		async ({ params, set }) => {
			const job = await IngestionService.getJob(params.id)
			if (!job) {
				set.status = 404
				return { error: 'Job not found' }
			}
			return { data: job }
		},
		{ beforeHandle: serviceAuth, params: IngestionModel.jobParams },
	)
	.get(
		'/jobs/:id/files',
		async ({ params, query }) => {
			return IngestionService.listFiles(params.id, query.limit ?? 100, query.offset ?? 0)
		},
		{ beforeHandle: serviceAuth, params: IngestionModel.jobParams, query: IngestionModel.filesQuery },
	)
	.post(
		'/jobs/:id/enqueue',
		async ({ params, set }) => {
			try {
				const result = await IngestionService.enqueueJob(params.id)
				set.status = 202
				return { data: result }
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				if (message.includes('Job not found')) {
					set.status = 404
					return { error: message }
				}
				set.status = 500
				return { error: message }
			}
		},
		{ beforeHandle: serviceAuth, params: IngestionModel.jobParams },
	)
	.get(
		'/jobs/:id/events',
		async ({ params, query, request, set }) => {
			const job = await IngestionService.getJob(params.id)
			if (!job) {
				set.status = 404
				return { error: 'Job not found' }
			}
			return streamJobEvents(params.id, job.collection, query.after ?? 0, request.signal)
		},
		{ beforeHandle: serviceAuth, params: IngestionModel.jobParams, query: IngestionModel.eventsQuery },
	)
