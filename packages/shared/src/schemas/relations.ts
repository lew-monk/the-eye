import { relations } from 'drizzle-orm'
import { documents, processingLogs } from './documents'
import { participants, documentChunks } from './paralegal'

export const documentsRelations = relations(documents, ({ many }) => ({
	logs: many(processingLogs),
	participants: many(participants),
	chunks: many(documentChunks),
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
