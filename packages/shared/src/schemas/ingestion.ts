import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core'

/**
 * Durable ingestion job aggregates. File-level rows live in
 * `judgment_documents` (keyed by checksum + job_id); this table owns the
 * per-job counters the UI polls, so jobs survive API restarts.
 */
export const ingestionJobs = pgTable('ingestion_jobs', {
	id: text('id').primaryKey(),
	collection: text('collection').notNull().default('judgments'),
	source: text('source').notNull(),
	root: text('root').notNull(),
	status: text('status').notNull().default('pending'),
	totalFiles: integer('total_files').notNull().default(0),
	doneFiles: integer('done_files').notNull().default(0),
	failedFiles: integer('failed_files').notNull().default(0),
	totalBytes: integer('total_bytes').notNull().default(0),
	transferredBytes: integer('transferred_bytes').notNull().default(0),
	lastError: text('last_error'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
	statusIdx: index('ingestion_jobs_status_idx').on(table.status),
	collectionIdx: index('ingestion_jobs_collection_idx').on(table.collection),
}))

export type IngestionJobRow = typeof ingestionJobs.$inferSelect
export type NewIngestionJobRow = typeof ingestionJobs.$inferInsert
