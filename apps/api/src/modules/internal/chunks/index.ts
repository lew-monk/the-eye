import { Elysia } from 'elysia'
import { ChunksService } from './service'
import { ChunkModel } from './model'
import { requirePermission } from '../../../middleware/auth'
import { getFailedEmbeddingJobs, retryFailedEmbeddingJobs, requeueFailedEmbeddingJobs } from '@workspace/workers'

export const chunks = new Elysia()
	.post(
		'/:id/chunks',
		async ({ params, body, set }) => {
			const documentId = Number(params.id)
			if (Number.isNaN(documentId)) {
				set.status = 400
				return { error: 'Invalid document id' }
			}

			const result = await ChunksService.store(
				documentId,
				body.chunks,
				body.embeddingVersion,
				body.embeddingProvider,
				body.embeddingModel,
				body.normalizedText,
			)

			if (!result) {
				set.status = 404
				return { error: 'Document not found' }
			}

			return { success: true, count: result.count }
		},
		{
			beforeHandle: [requirePermission({ service: 'api', resource: 'documents', actions: ['create'] })],
			body: ChunkModel.body,
		},
	)
	.get(
		'/:id/embeddings/failed',
		async ({ params, set }) => {
			const documentId = Number(params.id)
			if (Number.isNaN(documentId)) {
				set.status = 400
				return { error: 'Invalid document id' }
			}

			const jobs = await getFailedEmbeddingJobs(documentId)
			return { jobs }
		},
		{
			beforeHandle: [requirePermission({ service: 'api', resource: 'documents', actions: ['create'] })],
		},
	)
	.post(
		'/:id/embeddings/retry',
		async ({ params, set }) => {
			const documentId = Number(params.id)
			if (Number.isNaN(documentId)) {
				set.status = 400
				return { error: 'Invalid document id' }
			}

			const retried = await retryFailedEmbeddingJobs(documentId)
			return { retried }
		},
		{
			beforeHandle: [requirePermission({ service: 'api', resource: 'documents', actions: ['create'] })],
		},
	)
	.post(
		'/:id/embeddings/requeue',
		async ({ params, set }) => {
			const documentId = Number(params.id)
			if (Number.isNaN(documentId)) {
				set.status = 400
				return { error: 'Invalid document id' }
			}

			const requeued = await requeueFailedEmbeddingJobs(documentId)
			return { requeued }
		},
		{
			beforeHandle: [requirePermission({ service: 'api', resource: 'documents', actions: ['create'] })],
		},
	)
