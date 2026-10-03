import { pgTable, text, integer, timestamp, serial, real, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { cases } from './cases'
import { vector } from './paralegal'
import { EMBEDDING_COLUMN_DIMENSIONS } from '../embeddings'

export { EMBEDDING_COLUMN_DIMENSIONS }

/**
 * Judgment documents — own table per ingestion-engine plan.
 * `checksum` (sha256 of bytes) is unique for idempotent resume.
 * `relativePath` preserves the file's position inside nested folders.
 */
export const judgmentDocuments = pgTable('judgment_documents', {
	id: serial('id').primaryKey(),
	/** Document collection. Defaults to 'judgments'; any folder can be ingested. */
	collection: text('collection').notNull().default('judgments'),
	source: text('source').notNull(),
	sourceKey: text('source_key').notNull(),
	relativePath: text('relative_path').notNull(),
	filename: text('filename').notNull(),
	sizeBytes: integer('size_bytes').notNull(),
	checksum: text('checksum').notNull().unique(),
	storageKey: text('storage_key'),
	storageBucket: text('storage_bucket'),
	status: text('status').notNull().default('discovered'),
	attempts: integer('attempts').notNull().default(0),
	lastError: text('last_error'),
	bytesTransferred: integer('bytes_transferred').notNull().default(0),
	ocrText: text('ocr_text'),
	summary: text('summary'),
	caseId: integer('case_id').references(() => cases.id, { onDelete: 'set null' }),
	jobId: text('job_id'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
	statusIdx: index('judgment_documents_status_idx').on(table.status),
	checksumIdx: uniqueIndex('judgment_documents_checksum_uidx').on(table.checksum),
	collectionIdx: index('judgment_documents_collection_idx').on(table.collection),
	sourceIdx: index('judgment_documents_source_idx').on(table.source),
	jobIdx: index('judgment_documents_job_idx').on(table.jobId),
	caseIdx: index('judgment_documents_case_idx').on(table.caseId),
}))

export const judgmentChunks = pgTable('judgment_chunks', {
	id: serial('id').primaryKey(),
	judgmentId: integer('judgment_id')
		.notNull()
		.references(() => judgmentDocuments.id, { onDelete: 'cascade' }),
	chunkIndex: integer('chunk_index').notNull(),
	text: text('text').notNull(),
	embedding: vector('embedding', { dimensions: EMBEDDING_COLUMN_DIMENSIONS }),
	embeddingProvider: text('embedding_provider'),
	embeddingModel: text('embedding_model'),
	embeddingDimensions: integer('embedding_dimensions'),
	textHash: text('text_hash'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
	docChunkIdx: uniqueIndex('idx_judgment_chunks_doc_chunk').on(table.judgmentId, table.chunkIndex),
	judgmentIdx: index('idx_judgment_chunks_judgment_id').on(table.judgmentId),
	embeddingModelIdx: index('idx_judgment_chunks_embedding_model').on(table.embeddingModel),
}))

export type JudgmentDocument = typeof judgmentDocuments.$inferSelect
export type NewJudgmentDocument = typeof judgmentDocuments.$inferInsert
export type JudgmentChunk = typeof judgmentChunks.$inferSelect
export type NewJudgmentChunk = typeof judgmentChunks.$inferInsert
