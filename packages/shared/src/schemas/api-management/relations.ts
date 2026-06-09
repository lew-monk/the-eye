import { relations } from "drizzle-orm"
import { apiKeys, apiKeyUsages, apiUsers } from "./api-management"

export const apiKeyUsagesRelations = relations(apiKeyUsages, ({ one }) => ({
	apiKeyUsages: one(apiKeys, {
		fields: [apiKeyUsages.apiKeyId],
		references: [apiKeys.id],
	}),
}))

export const apiKeysOwnerRelations = relations(apiKeys, ({ one }) => ({
	owner: one(apiUsers, {
		fields: [apiKeys.userId],
		references: [apiUsers.id],
	}),
}))
