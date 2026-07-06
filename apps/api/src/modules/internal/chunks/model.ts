import { t } from 'elysia'

export const ChunkModel = {
	body: t.Object({
		chunks: t.Array(
		t.Object({
			chunkIndex: t.Number(),
			text: t.String(),
			embedding: t.Optional(t.Array(t.Number())),
			chunkTextHash: t.Optional(t.String()),
			tokenCount: t.Optional(t.Number()),
			positionWeight: t.Optional(t.Number()),
		}),
		),
		normalizedText: t.Optional(t.String()),
		embeddingVersion: t.Number(),
		embeddingProvider: t.String(),
		embeddingModel: t.String(),
	}),
}
