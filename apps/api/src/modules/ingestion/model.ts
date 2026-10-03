import { t } from 'elysia'

export const IngestionModel = {
	createJobBody: t.Object({
		source: t.Union([t.Literal('local-fs'), t.Literal('s3')]),
		root: t.String({ minLength: 1 }),
		collection: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
	}),
	jobParams: t.Object({
		id: t.String({ minLength: 1 }),
	}),
	filesQuery: t.Object({
		limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1000, default: 100 })),
		offset: t.Optional(t.Numeric({ minimum: 0, default: 0 })),
	}),
	eventsQuery: t.Object({
		after: t.Optional(t.Numeric({ minimum: 0, default: 0 })),
	}),
}
