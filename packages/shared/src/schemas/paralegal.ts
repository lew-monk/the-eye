import { pgTable, text, integer, timestamp, serial, real, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { customType } from 'drizzle-orm/pg-core'
import { documents } from './documents'

// Custom vector type for pgvector (sized for largest model we might use)
export const EMBEDDING_COLUMN_DIMENSIONS = 3072

export const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
	dataType(config) {
		return `vector(${config?.dimensions ?? EMBEDDING_COLUMN_DIMENSIONS})`
	},
	toDriver(value: number[]): string {
		return JSON.stringify(value)
	},
	fromDriver(value: string): number[] {
		return JSON.parse(value)
	},
})

// Participants extracted from coref clusters
export const participants = pgTable('participants', {
	id: serial('id').primaryKey(),
	documentId: integer('document_id')
		.notNull()
		.references(() => documents.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	normalizedName: text('normalized_name').notNull(),
	role: text('role').notNull().default('other'),
	roleConfidence: real('role_confidence').default(0),
	entityType: text('entity_type'),
	mentionCount: integer('mention_count').default(0),
	mentions: text('mentions').array().default([]),
	clusterId: integer('cluster_id'),
	relevanceScore: real('relevance_score').default(0),
	extractionVersion: integer('extraction_version').default(1),
}, (table) => ({
	documentIdx: index('idx_participants_document_id').on(table.documentId),
	normalizedNameIdx: index('idx_participants_normalized_name').on(table.normalizedName),
	roleIdx: index('idx_participants_role').on(table.role),
	docRoleIdx: index('idx_participants_doc_role').on(table.documentId, table.role),
}))

// Bag-of-chunks: one row per chunk per document
export const documentChunks = pgTable('document_chunks', {
	id: serial('id').primaryKey(),
	documentId: integer('document_id')
		.notNull()
		.references(() => documents.id, { onDelete: 'cascade' }),
	chunkIndex: integer('chunk_index').notNull(),
	text: text('text').notNull(),
	embedding: vector('embedding', { dimensions: EMBEDDING_COLUMN_DIMENSIONS }),
	embeddingProvider: text('embedding_provider'),
	embeddingModel: text('embedding_model'),
	chunkTextHash: text('chunk_text_hash'),
	tokenCount: integer('token_count'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
	docChunkIdx: uniqueIndex('idx_chunks_document_chunk').on(table.documentId, table.chunkIndex),
	documentIdx: index('idx_chunks_document_id').on(table.documentId),
}))

// Types
export type Participant = typeof participants.$inferSelect
export type NewParticipant = typeof participants.$inferInsert
export type DocumentChunk = typeof documentChunks.$inferSelect
export type NewDocumentChunk = typeof documentChunks.$inferInsert
