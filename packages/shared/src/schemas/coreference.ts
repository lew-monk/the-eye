import { pgTable, text, integer, timestamp, serial, boolean, index } from 'drizzle-orm/pg-core'
import { documents } from './documents'

export const coreferenceResults = pgTable('coreference_results', {
	id: serial('id').primaryKey(),
	documentId: integer('document_id')
		.notNull()
		.references(() => documents.id, { onDelete: 'cascade' }),
	resolvedText: text('resolved_text'),
	model: text('model').notNull(),
	modelVersion: text('model_version').notNull(),
	sourceTextHash: text('source_text_hash'),
	processedAt: timestamp('processed_at'),
	processingTimeMs: integer('processing_time_ms'),
	inputCharCount: integer('input_char_count'),
	chunked: boolean('chunked'),
	chunkSize: integer('chunk_size'),
	chunkCount: integer('chunk_count'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
	documentIdx: index('idx_coref_results_document_id').on(table.documentId),
}))

export const coreferenceClusters = pgTable('coreference_clusters', {
	id: serial('id').primaryKey(),
	resultId: integer('result_id')
		.notNull()
		.references(() => coreferenceResults.id, { onDelete: 'cascade' }),
	clusterIndex: integer('cluster_index').notNull(),
}, (table) => ({
	resultIdx: index('idx_coref_clusters_result_id').on(table.resultId),
}))

export const coreferenceMentions = pgTable('coreference_mentions', {
	id: serial('id').primaryKey(),
	clusterId: integer('cluster_id')
		.notNull()
		.references(() => coreferenceClusters.id, { onDelete: 'cascade' }),
	text: text('text').notNull(),
	startPos: integer('start_pos').notNull(),
	endPos: integer('end_pos').notNull(),
}, (table) => ({
	clusterIdx: index('idx_coref_mentions_cluster_id').on(table.clusterId),
}))

export type CoreferenceResult = typeof coreferenceResults.$inferSelect
export type NewCoreferenceResult = typeof coreferenceResults.$inferInsert
export type CoreferenceCluster = typeof coreferenceClusters.$inferSelect
export type NewCoreferenceCluster = typeof coreferenceClusters.$inferInsert
export type CoreferenceMention = typeof coreferenceMentions.$inferSelect
export type NewCoreferenceMention = typeof coreferenceMentions.$inferInsert
