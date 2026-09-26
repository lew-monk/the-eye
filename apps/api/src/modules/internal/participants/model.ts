import { t, type Static } from 'elysia'

export const ParticipantModel = {
	body: t.Object({
		participants: t.Array(
			t.Object({
				name: t.String(),
				normalizedName: t.String(),
				role: t.String(),
				roleConfidence: t.Optional(t.Number()),
				entityType: t.Nullable(t.Optional(t.String())),
				mentionCount: t.Optional(t.Number()),
				mentions: t.Optional(t.Array(t.String())),
				clusterId: t.Optional(t.Number()),
				relevanceScore: t.Optional(t.Number()),
			}),
		),
		extractionVersion: t.Number(),
	}),
}

export type ParticipantStoreBody = Static<typeof ParticipantModel.body>
export type ParticipantIngest = ParticipantStoreBody['participants'][number]
