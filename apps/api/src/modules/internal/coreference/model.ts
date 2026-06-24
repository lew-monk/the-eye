import { t } from 'elysia'

export const CoreferenceModel = {
	body: t.Object({
		resolved_text: t.String(),
		clusters: t.Array(t.Any()),
		mentions: t.Array(t.Any()),
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
