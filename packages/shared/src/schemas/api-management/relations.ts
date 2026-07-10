import { relations } from "drizzle-orm"
import { apiKeys, apiKeyUsages } from "./api-management"
import { users } from "../auth"

export const apiKeyUsagesRelations = relations(apiKeyUsages, ({ one }) => ({
	apiKeyUsages: one(apiKeys, {
		fields: [apiKeyUsages.apiKeyId],
		references: [apiKeys.id],
	}),
}))

export const apiKeysOwnerRelations = relations(apiKeys, ({ one }) => ({
	owner: one(users, {
		fields: [apiKeys.userId],
		references: [users.id],
	}),
}))
