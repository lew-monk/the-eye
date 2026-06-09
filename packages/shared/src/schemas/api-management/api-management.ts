import { bigint, boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// API Management
export type Permission = {
	service: string // e.g. api
	resource: string // e.g. documents,ocr
	actions: string[] // e.g. create,read,update,delete
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
	resource: string, // e.g. Service and action being accessed
	windowMs: number, // Time window in milliseconds
	maxRequests: number, // Maximum number of requests allowed in the window
	message: string, // Error message to return if rate limit is exceeded
	maxBytes?: number, // Maximum number of bytes allowed in the window
}

export const apiUsers = pgTable('api_users', {
	id: serial('id').primaryKey(),
	username: text('username').notNull(),
	email: text('email').notNull(),
	subscriptionTier: text('subscription_tier'),
	organizationId: text('organization'),
	metadata: jsonb('metadata').$type<Record<string, any>>(),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})


export const apiKeys = pgTable('api_keys', {
	id: serial('id').primaryKey(),
	userId: text('user_id').references(() => apiUsers.id).notNull(),
	name: text('name').notNull(),
	keyHash: text('key_hash').notNull(),
	keyPrefix: text('key_prefix').notNull(),
	permission: jsonb('permission').$type<Permission[]>().notNull(),
	scopes: jsonb('scopes').$type<string[]>(),
	rateLimit: jsonb('rate_limit').$type<RateLimit>(),
	expiresAt: timestamp('expires_at').notNull(),
	lastUsedAt: timestamp('last_used_at').defaultNow(),
	isActive: boolean('is_active').default(true),
	// createdAt: timestamp('created_at').defaultNow(),
	// updatedAt: timestamp('updated_at').defaultNow(),
	allowedIps: text('allowed_ips').array(),
	allowedDomains: text('allowed_domains').array(),
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
	timestamp: timestamp('timestamp').defaultNow().notNull(),
})

export type ApiKey = typeof apiKeys.$inferSelect
export type ApiKeyUsage = typeof apiKeyUsages.$inferSelect
export type ApiKeyUsageInsert = typeof apiKeyUsages.$inferInsert
export type ApiKeyUser = typeof apiUsers.$inferSelect
