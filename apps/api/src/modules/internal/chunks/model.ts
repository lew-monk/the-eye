import { t, type Static } from 'elysia'

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
			parentChunkIndex: t.Optional(t.Nullable(t.Number())),
			section: t.Optional(t.String()),
			chunkUid: t.Optional(t.String()),
			ocrConfidence: t.Optional(t.Number()),
		}),
		),
		normalizedText: t.Optional(t.String()),
		embeddingVersion: t.Number(),
		embeddingProvider: t.String(),
		embeddingModel: t.String(),
	}),
}

export type ChunkStoreBody = Static<typeof ChunkModel.body>
export type ChunkIngest = ChunkStoreBody['chunks'][number]
