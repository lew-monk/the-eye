import { pgTable, text, integer, jsonb, timestamp, serial, real, index } from 'drizzle-orm/pg-core'
import { cases } from './cases'

export const documents = pgTable('documents', {
	id: serial('id').primaryKey(),
	caseId: integer('case_id').references(() => cases.id, { onDelete: 'set null' }),
	filename: text('filename').notNull(),
	fileType: text('file_type').notNull(),
	fileSize: integer('file_size').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	processedAt: timestamp('processed_at'),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),

	// Extracted data
	structuredData: jsonb('structured_data'),
	fullContent: jsonb('full_content'),
	coreferenceResolvedContent: jsonb('coreference_resolved_content'),
	normalizedText: text('normalized_text'),
	confidence: real('confidence'),

	// Metadata
	documentType: text('document_type').notNull(),
	caseNumber: text('case_number'),
	court: text('court'),
	parties: jsonb('parties'),
	fileHash: text('file_hash'),
	textHash: text('text_hash'),

	// Status
	status: text('status').default('pending').notNull(),
	errorMessage: text('error_message'),

	// Paralegal version tracking
	extractionVersion: integer('extraction_version').default(1),
	embeddingVersion: integer('embedding_version').default(1),
	embeddingProvider: text('embedding_provider'),
	embeddingModel: text('embedding_model'),
}, (table) => ({
	statusIdx: index('documents_status_idx').on(table.status),
	documentTypeIdx: index('documents_type_idx').on(table.documentType),
	caseNumberIdx: index('documents_case_number_idx').on(table.caseNumber),
	caseIdIdx: index('documents_case_id_idx').on(table.caseId),
	fileHashIdx: index('documents_file_hash_idx').on(table.fileHash),
	textHashIdx: index('documents_text_hash_idx').on(table.textHash),
}))

export const processingLogs = pgTable('processing_logs', {
	id: serial('id').primaryKey(),
	documentId: integer('document_id').references(() => documents.id),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	action: text('action').notNull(),
	details: jsonb('details'),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Types
export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
export type ProcessingLog = typeof processingLogs.$inferSelect
export type NewProcessingLog = typeof processingLogs.$inferInsert
