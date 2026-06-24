import { Elysia } from 'elysia'
import { ApiKeyService, ApiKeyRepository } from '@workspace/shared'
import { AdminModel } from './model'

let apiKeyRepository: ApiKeyRepository = new ApiKeyRepository()
let apiKeyService: ApiKeyService = new ApiKeyService(apiKeyRepository)

export const admin = new Elysia({ prefix: '/admin' }).post(
	'/api-keys',
	async ({ body }) => {
		let req = body
		try {
			const result = await apiKeyService.createKey(
				req.userId,
				req.name,
				req.permission,
				req.scopes || null,
				req.rateLimit || null,
				new Date(req.expiresAt),
			)
			return { success: true, ...result }
		} catch (error) {
			console.error('Admin create key error:', error)
			return { error: String(error) }
		}
	},
	{
		body: AdminModel.data,
	},
)
