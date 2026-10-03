import { ApiKeyRepository } from "../repositories/api-key";
import { type Permission, type RateLimit, type ApiKey } from "../schemas";
import { InsufficientPermissionsError, InvalidApiKeyError } from "../exceptions";
import IORedis from 'ioredis'
import crypto from 'crypto'
import { getQueueConfig } from "../queue";

/**
 * API Key Service. Validates API keys and permissions.
 * Uses Redis for rate limit data, permission data, and usage data.
 */
export function hashApiKey(rawKey: string): string {
	// Store keys as sha256(raw). Hash each lookup first.
	// A raw value never matches the hash column.
	return crypto.createHash('sha256').update(rawKey).digest('hex')
}

export class ApiKeyService {
	private connection: IORedis
	constructor(
		private apiKeyRepository: ApiKeyRepository,
		connection?: Pick<IORedis, 'get' | 'set' | 'del'>,
	) {
		if (connection) {
			this.connection = connection as IORedis
		} else {
			const config = getQueueConfig()
			this.connection = new IORedis(config.redisUrl, {
				maxRetriesPerRequest: null,
			})
		}
	}
	/**
	 * Add the API key to Redis.
	 * Redis holds rate limit data, permission data, and usage data.
	 * @param apiKey {ApiKey} The API key to store.
	 * @returns {Promise<void>} Resolves when the system stores the API key.
	 * */
	async addApiKeyToRedis(apiKey: ApiKey): Promise<void> {
		const key = `api-key:${apiKey.keyHash}`
		await this.connection.set(key, JSON.stringify(apiKey))
	}
	/**
	 * Remove the API key from Redis.
	 * @param apiKey {ApiKey} The API key to remove.
	 * @returns {Promise<void>} Resolves when the system removes the API key.
	 * */
	async removeApiKeyFromRedis(apiKey: ApiKey): Promise<void> {
		const key = `api-key:${apiKey.keyHash}`
		await this.connection.del(key)
	}
	/**
	 * Get the API key from Redis.
	 * @param apiKeyHash {string} The API key hash.
	 * @returns {Promise<ApiKey | null>} The API key, or null when not found.
	 * */
	async getApiKeyFromRedis(apiKeyHash: string): Promise<ApiKey | null> {
		try {
			const key = `api-key:${apiKeyHash}`
			const value = await this.connection.get(key)
			if (!value) {
				return null
			}
			return JSON.parse(value)
		} catch (error) {
			console.error('Error getting API key from Redis:', error)
			return null
		}
	}

	/**
	 * Update the API key in Redis.
	 * @param apiKey The API key to update.
	 * @returns {Promise<{allowed: boolean, apiKey: ApiKey}>} The update result. Allowed is always true.
	 */
	async updateApiKeyInRedis(apiKey: ApiKey): Promise<{ allowed: boolean, apiKey: ApiKey }> {
		const key = `api-key:${apiKey.keyHash}`
		await this.connection.set(key, JSON.stringify(apiKey))
		return { allowed: true, apiKey }
	}

	/**
	 * Check if the API key has the required permission.
	 * @param apiKey The raw API key value.
	 * @param permission The required permission.
	 * @returns {Promise<{allowed: boolean, apiKey: ApiKey}>} The check result and the API key record.
	 */
	async checkPermission(apiKey: string, permission: Permission): Promise<{ allowed: boolean, apiKey: ApiKey }> {
		const apiKeyRecord = await this.getApiKey(apiKey)
		if (!apiKeyRecord) {
			throw new InvalidApiKeyError('Invalid API key')
		}

		// Check the service permission.
		let permissionReference = apiKeyRecord.permission.findIndex(p => p.service === permission.service)
		if (permissionReference === -1) {
			throw new InsufficientPermissionsError('Invalid service permission')
		}

		// Check the resource permission.
		if (apiKeyRecord.permission[permissionReference]!.resource !== permission.resource) {
			throw new InsufficientPermissionsError('Invalid resource permission')
		}

		// Check each requested action.
		if (permission.actions.length > 0) {
			const allowedActions = apiKeyRecord.permission[permissionReference]!.actions
			const hasWildcard = allowedActions.includes('*')

			for (const action of permission.actions) {
				if (!hasWildcard && !allowedActions.includes(action)) {
					throw new InsufficientPermissionsError(`Action '${action}' not allowed for resource '${permission.resource}'`)
				}
			}
		} else {
			throw new InsufficientPermissionsError('No actions requested')
		}
		return { allowed: true, apiKey: apiKeyRecord }

	}

	/**
	 * Get the API key from Redis or the database.
	 * Check Redis first. Then check the database. Store database hits in Redis.
	 * @param apiKey {string} The raw API key value from the caller.
	 * @returns {Promise<ApiKey | null>} The API key, or null when not found.
	 * */
	async getApiKey(apiKey: string): Promise<ApiKey | null> {
		console.log('getApiKey', apiKey)
		const keyHash = hashApiKey(apiKey)
		// Check Redis first.
		let apiKeyRecord = await this.getApiKeyFromRedis(keyHash)
		if (apiKeyRecord) {
			return apiKeyRecord
		}

		// Check the database next.
		apiKeyRecord = await this.apiKeyRepository.findByHash(keyHash)
		console.log('apiKeyRecord', apiKeyRecord)
		if (!apiKeyRecord) {
			return null
		}

		// Store the database record in Redis.
		await this.addApiKeyToRedis(apiKeyRecord)
		return apiKeyRecord
	}

	/**
	 * Check if the API key exceeds the rate limit.
	 * @param {string} apiKeyId The raw API key value.
	 * @param {Permission} permission The required permission.
	 * @returns {Promise<boolean>} True when the call is allowed. False when the limit blocks it.
	 */
	async checkRateLimit(apiKeyId: string, permission: Permission, _resource: string): Promise<boolean> {
		let { allowed, apiKey } = await this.checkPermission(apiKeyId, permission)

		if (!apiKey) {
			throw new InvalidApiKeyError('Invalid API key')
		}

		// Check the requested action.
		if (!allowed) {
			throw new InsufficientPermissionsError('Insufficient permissions')
		}

		// Allow the call when no rate limit is set.
		if (!apiKey.rateLimit) {
			return true
		}
		return false

	}

	async createKey(
		userId: string,
		name: string,
		permission: Permission[],
		scopes: string[] | null,
		rateLimit: RateLimit | null,
		expiresAt: Date,
	): Promise<{ rawKey: string; apiKey: ApiKey }> {
		const rawKey = crypto.randomBytes(32).toString('hex')
		const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')
		const keyPrefix = rawKey.slice(0, 8)

		const apiKeyRecord = await this.apiKeyRepository.createKey(
			userId,
			name,
			keyHash,
			keyPrefix,
			permission,
			scopes,
			rateLimit,
			expiresAt,
		)

		await this.addApiKeyToRedis(apiKeyRecord)

		return { rawKey, apiKey: apiKeyRecord }
	}
}
