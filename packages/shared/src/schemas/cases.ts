import { pgTable, text, integer, jsonb, timestamp, serial, real, index } from 'drizzle-orm/pg-core'

export const cases = pgTable('cases', {
	id: serial('id').primaryKey(),
	caseNumber: text('case_number').notNull().unique(),
	title: text('title').notNull(),
	description: text('description'),
	caseType: text('case_type').notNull(),
	status: text('status').default('active').notNull(),
	parties: text('parties').array(),
	tags: text('tags').array(),
	metadata: jsonb('metadata'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
	caseNumberIdx: index('cases_case_number_idx').on(table.caseNumber),
	caseTypeIdx: index('cases_case_type_idx').on(table.caseType),
	statusIdx: index('cases_status_idx').on(table.status),
}))

export const caseRelations = pgTable('case_relations', {
	id: serial('id').primaryKey(),
	sourceCaseId: integer('source_case_id')
		.notNull()
		.references(() => cases.id, { onDelete: 'cascade' }),
	targetCaseId: integer('target_case_id')
		.notNull()
		.references(() => cases.id, { onDelete: 'cascade' }),
	relationType: text('relation_type').notNull(),
	entityName: text('entity_name'),
	strength: real('strength'),
	metadata: jsonb('metadata'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
	sourceIdx: index('case_relations_source_idx').on(table.sourceCaseId),
	targetIdx: index('case_relations_target_idx').on(table.targetCaseId),
}))

export type Case = typeof cases.$inferSelect
export type NewCase = typeof cases.$inferInsert
export type CaseRelation = typeof caseRelations.$inferSelect
export type NewCaseRelation = typeof caseRelations.$inferInsert
