import { t } from 'elysia'

const PermissionConditionModel = t.Optional(
	t.Object({
		maxFileSize: t.Optional(t.Number()),
		maxFileCount: t.Optional(t.Number()),
		maxDocumentCount: t.Optional(t.Number()),
		maxDocumentSize: t.Optional(t.Number()),
		minConfidence: t.Optional(t.Number()),
		dailyLimit: t.Optional(t.Number()),
		allowedFileTypes: t.Optional(t.Array(t.String())),
	}),
)

const PermissionModel = t.Object({
	service: t.String(),
	resource: t.String(),
	actions: t.Array(t.String()),
	conditions: PermissionConditionModel,
})

const RateLimitModel = t.Optional(
	t.Object({
		resource: t.String(),
		windowMs: t.Number(),
		maxRequests: t.Number(),
		message: t.String(),
		maxBytes: t.Optional(t.Number()),
	}),
)

export const AdminModel = {
	data: t.Object({
		userId: t.String(),
		name: t.String(),
		permission: t.Array(PermissionModel),
		scopes: t.Optional(t.Array(t.String())),
		rateLimit: RateLimitModel,
		expiresAt: t.String(),
	}),
}
