import { relations } from 'drizzle-orm'
import { documents, processingLogs } from './documents'
import { participants, documentChunks } from './paralegal'
import { coreferenceResults, coreferenceClusters, coreferenceMentions } from './coreference'

export const documentsRelations = relations(documents, ({ many }) => ({
	logs: many(processingLogs),
	participants: many(participants),
	chunks: many(documentChunks),
	coreferenceResults: many(coreferenceResults),
}))

export const coreferenceResultsRelations = relations(coreferenceResults, ({ one, many }) => ({
	document: one(documents, {
		fields: [coreferenceResults.documentId],
		references: [documents.id],
	}),
	clusters: many(coreferenceClusters),
}))

export const coreferenceClustersRelations = relations(coreferenceClusters, ({ one, many }) => ({
	result: one(coreferenceResults, {
		fields: [coreferenceClusters.resultId],
		references: [coreferenceResults.id],
	}),
	mentions: many(coreferenceMentions),
}))

export const coreferenceMentionsRelations = relations(coreferenceMentions, ({ one }) => ({
	cluster: one(coreferenceClusters, {
		fields: [coreferenceMentions.clusterId],
		references: [coreferenceClusters.id],
	}),
}))

export const processingLogsRelations = relations(processingLogs, ({ one }) => ({
	document: one(documents, {
		fields: [processingLogs.documentId],
		references: [documents.id],
	}),
}))

export const participantsRelations = relations(participants, ({ one }) => ({
	document: one(documents, {
		fields: [participants.documentId],
		references: [documents.id],
	}),
}))

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
	document: one(documents, {
		fields: [documentChunks.documentId],
		references: [documents.id],
	}),
}))
