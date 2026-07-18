import { bigint, boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type Permission = {
	service: string
	resource: string
	actions: string[]
	conditions?: {
		maxFileSize?: number
		maxFileCount?: number
		maxDocumentCount?: number
		maxDocumentSize?: number
		minConfidence?: number
		dailyLimit?: number
		allowedFileTypes?: string[]
	}
}

export type RateLimit = {
	resource: string
	windowMs: number
	maxRequests: number
	message: string
	maxBytes?: number
}

export const apiKeys = pgTable('api_keys', {
	id: serial('id').primaryKey(),
	userId: text('user_id').notNull(),
	name: text('name').notNull(),
	keyHash: text('key_hash').notNull(),
	keyPrefix: text('key_prefix').notNull(),
	permission: jsonb('permission').$type<Permission[]>().notNull(),
	scopes: jsonb('scopes').$type<string[]>(),
	rateLimit: jsonb('rate_limit').$type<RateLimit>(),
	expiresAt: timestamp('expires_at').notNull(),
	lastUsedAt: timestamp('last_used_at').defaultNow(),
	isActive: boolean('is_active').default(true),
	allowedIps: text('allowed_ips').array(),
	allowedDomains: text('allowed_domains').array(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const apiKeyUsages = pgTable('api_key_usages', {
	id: serial('id').primaryKey(),
	apiKeyId: serial('api_key_id'),

	service: text('service').notNull(),
	endpoint: text('endpoint').notNull(),
	method: text('method').notNull(),

	statusCode: integer('status').notNull(),
	responseTime: integer('response_time_ms').notNull(),
	success: boolean('success').notNull(),

	bytesProcessed: bigint('bytes_processed', { mode: 'number' }).notNull(),
	creditsUsed: integer('credits_used').notNull(),
	ipAddress: text('ip_address').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type ApiKey = typeof apiKeys.$inferSelect
export type ApiKeyUsage = typeof apiKeyUsages.$inferSelect
export type ApiKeyUsageInsert = typeof apiKeyUsages.$inferInsert
