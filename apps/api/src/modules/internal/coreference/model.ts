import { t, type Static } from 'elysia'

export const CoreferenceMentionModel = t.Object({
	text: t.String(),
	start: t.Number(),
	end: t.Number(),
	cluster_id: t.Number(),
})

export const CoreferenceModel = {
	body: t.Object({
		resolved_text: t.String(),
		clusters: t.Array(t.Array(t.String())),
		mentions: t.Array(CoreferenceMentionModel),
		model: t.String(),
		model_version: t.String(),
		source_text_hash: t.String(),
		processed_at: t.String(),
		processing_time_ms: t.Number(),
		input_char_count: t.Number(),
		chunked: t.Optional(t.Boolean()),
		chunk_size: t.Optional(t.Number()),
		chunk_count: t.Optional(t.Number()),
	}),
}

export type CoreferenceStoreBody = Static<typeof CoreferenceModel.body>
