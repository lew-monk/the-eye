import { eq, sql } from "drizzle-orm";
import { type ApiKey, apiKeys, Permission, RateLimit } from "../schemas";
import { BaseRepository } from "./base";

export class ApiKeyRepository extends BaseRepository<ApiKey> {
	constructor() {
		super(apiKeys);
	}
	async createKey(
		userId: string,
		name: string,
		keyHash: string,
		keyPrefix: string,
		permission: Permission[],
		scopes: string[] | null,
		rateLimit: RateLimit | null,
		expiresAt: Date,
	): Promise<ApiKey> {
		const result = await this.create({
			userId,
			name,
			isActive: true,
			keyHash,
			keyPrefix,
			permission,
			scopes,
			rateLimit,
			lastUsedAt: new Date(),
			allowedIps: [],
			allowedDomains: [],
			expiresAt,
		})
		return result
	}

	async rotateApiKey(apiKey: ApiKey, newKeyHash: string, newKeyPrefix: string): Promise<ApiKey> {
		const newKey = await this.createKey(
			apiKey.userId,
			apiKey.name,
			newKeyHash,
			newKeyPrefix,
			apiKey.permission,
			apiKey.scopes,
			apiKey.rateLimit,
			apiKey.expiresAt,
		)
		await this.deleteById(apiKey.id)
		return newKey
	}

	async deactivateApiKey(apiKey: ApiKey): Promise<ApiKey | null> {
		const result = await this.updateById(apiKey.id, { isActive: false })
		return result
	}

	async updateKeyPermission(apiKey: ApiKey, permission: Permission[]): Promise<ApiKey | null> {
		const result = await this.updateById(apiKey.id, { permission })
		return result
	}

	async findByUserId(userId: string): Promise<ApiKey[]> {
		const result = await this.findMany([eq(apiKeys.userId, userId)])
		return result.data
	}

	async findByHash(keyHash: string): Promise<ApiKey | null> {
		const result = await this.findMany([eq(apiKeys.keyHash, keyHash)])
		return result.data[0] || null
	}
}
