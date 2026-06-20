import { pgTable, text, integer, jsonb, timestamp, serial, real, index } from 'drizzle-orm/pg-core'

export const documents = pgTable('documents', {
	id: serial('id').primaryKey(),
	filename: text('filename').notNull(),
	fileType: text('file_type').notNull(),
	fileSize: integer('file_size').notNull(),
	uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
	processedAt: timestamp('processed_at'),

	// Extracted data
	structuredData: jsonb('structured_data'),
	fullContent: jsonb('full_content'),
	coreferenceResolvedContent: jsonb('coreference_resolved_content'),
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
	fileHashIdx: index('documents_file_hash_idx').on(table.fileHash),
	textHashIdx: index('documents_text_hash_idx').on(table.textHash),
}))

export const processingLogs = pgTable('processing_logs', {
	id: serial('id').primaryKey(),
	documentId: integer('document_id').references(() => documents.id),
	timestamp: timestamp('timestamp').defaultNow().notNull(),
	action: text('action').notNull(),
	details: jsonb('details'),
})

// Types
export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
export type ProcessingLog = typeof processingLogs.$inferSelect
export type NewProcessingLog = typeof processingLogs.$inferInsert
