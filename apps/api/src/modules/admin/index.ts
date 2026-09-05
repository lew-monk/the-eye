import { Elysia, t } from 'elysia'
import { ApiKeyService, ApiKeyRepository } from '@workspace/shared'
import { AdminModel } from './model'

let apiKeyRepository: ApiKeyRepository = new ApiKeyRepository()
let apiKeyService: ApiKeyService = new ApiKeyService(apiKeyRepository)

export const admin = new Elysia({ prefix: '/admin' })
	.post(
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
	.get(
		'/api-keys',
		async ({ query }) => {
			try {
				const keys = await apiKeyRepository.findByUserId(query.userId)
				return keys.map((k) => ({
					id: k.id,
					name: k.name,
					keyPrefix: k.keyPrefix,
					permission: k.permission,
					scopes: k.scopes,
					isActive: k.isActive,
					lastUsedAt: k.lastUsedAt,
					expiresAt: k.expiresAt,
				}))
			} catch (error) {
				console.error('Admin list keys error:', error)
				return { error: String(error) }
			}
		},
		{
			query: t.Object({
				userId: t.String(),
			}),
		},
	)
	.post(
		'/api-keys/revoke',
		async ({ body }) => {
			try {
				await apiKeyRepository.deleteById(body.id)
				return { success: true }
			} catch (error) {
				console.error('Admin revoke key error:', error)
				return { error: String(error) }
			}
		},
		{
			body: t.Object({
				userId: t.String(),
				id: t.Number(),
			}),
		},
	)
