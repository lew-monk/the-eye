import { ApiKeyRepository } from "../repositories/api-key";
import { Permission, RateLimit, type ApiKey } from "../schemas";
import { InsufficientPermissionsError, InvalidApiKeyError } from "../exceptions";
import IORedis from 'ioredis'
import crypto from 'crypto'
import { getQueueConfig } from "../queue";

/**
 * API Key Service -- Validates API keys and permissions
 * @private {IORedis} connection - The Redis connection
 * @private {ApiKeyRepository} apiKeyRepository - The API key repository
 * @method addApiKeyToRedis - Add the API key to redis for rate limiting, permissions, and usage tracking
 * @method removeApiKeyFromRedis - Remove the API key from redis
 * @method getApiKeyFromRedis - Get the API key from redis
 * @method updateApiKeyInRedis - Update the API key in redis
 * @method getApiKey - Get the API key from the database or redis
 * @method checkPermission - Check if the API key has the required permissions
 * @method checkRateLimit - Check if the API key has passed the rate limit
 *
 */
export class ApiKeyService {
	private connection: IORedis
	constructor(
		private apiKeyRepository: ApiKeyRepository,
	) {
		const config = getQueueConfig()
		this.connection = new IORedis(config.redisUrl, {
			maxRetriesPerRequest: null,
		})
	}
	/**
	 * Add the API key to redis for rate limiting, permissions, and usage tracking
	 * @param apiKey {ApiKey} The API key to add to redis
	 * @returns {Promise<void>} A promise that resolves when the API key is added to redis
	 * */
	async addApiKeyToRedis(apiKey: ApiKey): Promise<void> {
		const key = `api-key:${apiKey.keyHash}`
		await this.connection.set(key, JSON.stringify(apiKey))
	}
	/**
	 * Remove the API key from redis
	 * @param apiKey {string} The API key hash
	 * @returns {Promise<void>} A promise that resolves when the API key is removed from redis
	 * */
	async removeApiKeyFromRedis(apiKey: ApiKey): Promise<void> {
		const key = `api-key:${apiKey.keyHash}`
		await this.connection.del(key)
	}
	/**
	 * Get the API key from redis
	 * @param apiKeyHash {string} The API key hash
	 * @returns {Promise<ApiKey | null>} A promise that resolves to the API key or null if not found
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
			console.error('Error getting API key from redis:', error)
			return null
		}
	}

	/**
	 * Update the API key in redis
	 * @param apiKey
	 * @param permission
	 * @returns {Promise<{allowed: boolean, apiKey: ApiKey}>} A promise object with allowed: true if the API key has the required permissions, false otherwise and apiKey: the API key record if allowed is true
	 */
	async updateApiKeyInRedis(apiKey: ApiKey): Promise<{ allowed: boolean, apiKey: ApiKey }> {
		const key = `api-key:${apiKey.keyHash}`
		await this.connection.set(key, JSON.stringify(apiKey))
		return { allowed: true, apiKey }
	}

	/**
	 * Check if the API key has the required permissions
	 * @param apiKey
	 * @param permission
	 * @returns {Promise<{allowed: boolean, apiKey: ApiKey}>} A promise object with allowed: true if the API key has the required permissions, false otherwise and apiKey: the API key record if allowed is true
	 */
	async checkPermission(apiKey: string, permission: Permission): Promise<{ allowed: boolean, apiKey: ApiKey }> {
		const apiKeyRecord = await this.getApiKey(apiKey)
		if (!apiKeyRecord) {
			throw new InvalidApiKeyError('Invalid API key')
		}

		// Check if the service permission exists
		let permissionReference = apiKeyRecord.permission.findIndex(p => p.service === permission.service)
		if (permissionReference === -1) {
			throw new InsufficientPermissionsError('Invalid service permission')
		}

		// Check if the resource permission exists
		if (apiKeyRecord.permission[permissionReference]!.resource !== permission.resource) {
			throw new InsufficientPermissionsError('Invalid resource permission')
		}

		// Check if the action is allowed
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
	 * Get the API key from the database or redis
	 * @param apiKey {string} The API key hash
	 * @returns {Promise<ApiKey | null>} A promise that resolves to the API key or null if not found
	 * */
	async getApiKey(apiKey: string): Promise<ApiKey | null> {
		console.log('getApiKey', apiKey)
		// Check if the API key exists in redis
		let apiKeyRecord = await this.getApiKeyFromRedis(apiKey)
		if (apiKeyRecord) {
			return apiKeyRecord
		}

		// Check if the API key exists in the database
		apiKeyRecord = await this.apiKeyRepository.findByHash(apiKey)
		console.log('apiKeyRecord', apiKeyRecord)
		if (!apiKeyRecord) {
			return null
		}

		// Add the API key to redis
		await this.addApiKeyToRedis(apiKeyRecord)
		return apiKeyRecord
	}

	/**
	 * Check if the API key has suppassed the set rate limit
	 * @param {string} apiKeyId
	 * @param {Permission} permission
	 * @returns {Promise<boolean>} A promise object with true if the API key has passed the rate limit, false otherwise
	 */
	async checkRateLimit(apiKeyId: string, permission: Permission, resource: string): Promise<boolean> {
		let { allowed, apiKey } = await this.checkPermission(apiKeyId, permission)

		if (!apiKey) {
			throw new InvalidApiKeyError('Invalid API key')
		}

		// Check if the action is allowed
		if (!allowed) {
			throw new InsufficientPermissionsError('Insufficient permissions')
		}

		// Check if rate limit is enabled
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
