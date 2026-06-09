import { ApiKeyService, ApiKeyRepository, Permission, InsufficientPermissionsError } from '@workspace/shared'
import { Context } from 'elysia'

let apiKeyRepository: ApiKeyRepository = new ApiKeyRepository()
let apiKeyService: ApiKeyService = new ApiKeyService(apiKeyRepository)

export const authMiddleware = async (c: Pick<Context, 'headers' | 'request' | 'status' | 'store'>) => {
	const authHeader = c.headers['X-API-KEY']

	if (!authHeader) {
		return c.status(403, 'Missing API key')
	}

	let permission: Permission = {
		service: 'elysia-api',
		resource: 'documents',
		actions: ['*'],
	}

	try {
		const { allowed, apiKey } = await apiKeyService.checkPermission(authHeader, permission)
		if (!allowed) {
			return c.status(403, 'Insufficient permissions')
		}
		c.store = {
			apiKey,
		}
		return
	} catch (e) {
		if (e instanceof InsufficientPermissionsError) {
			return c.status(403, 'Insufficient permissions')
		} else {
			return c.status(500, 'Internal server error')
		}
	}
}
