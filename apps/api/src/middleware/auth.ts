import { ApiKeyService, ApiKeyRepository, Permission, InsufficientPermissionsError } from '@workspace/shared'
import { Context } from 'elysia'

let apiKeyRepository: ApiKeyRepository = new ApiKeyRepository()
let apiKeyService: ApiKeyService = new ApiKeyService(apiKeyRepository)

export const requirePermission = (permission: Permission) => {
	return async (c: Pick<Context, 'headers' | 'request' | 'status' | 'store'>) => {
		const authHeader = c.headers['x-api-key']

		if (!authHeader) {
			return c.status(403, 'Missing API key')
		}

		try {
			const { allowed, apiKey } = await apiKeyService.checkPermission(authHeader, permission)
			if (!allowed) {
				return c.status(403, 'Insufficient permissions')
			}
			c.store = {
				...c.store,
				apiKey,
			}
			return
		} catch (e) {
			if (e instanceof InsufficientPermissionsError) {
				return c.status(403, e.message || 'Insufficient permissions')
			}
			console.error('Auth middleware error:', e)
			return c.status(500, 'Internal server error')
		}
	}
}

export const authMiddleware = requirePermission({
	service: 'api',
	resource: 'documents',
	actions: ['*'],
})

/** Shared worker/BFF token. If neither env is set, the route stays open (local dev). */
export const requireServiceToken = () => {
	return async (c: Pick<Context, 'headers' | 'status'>) => {
		const expected = process.env.API_SERVICE_TOKEN || process.env.COREF_SERVICE_TOKEN
		if (!expected) return

		const header = c.headers['x-api-key']
		const bearer = c.headers.authorization?.replace(/^Bearer\s+/i, '')
		const got = header || bearer
		if (got !== expected) {
			return c.status(401, 'Unauthorized')
		}
	}
}
