import { eq, sql, and, ilike } from 'drizzle-orm'
import { BaseRepository } from './base'
import { participants, documents, type Participant, type NewParticipant } from '../schemas'

export interface ParticipantWithCase extends Participant {
	caseNumber: string | null
	documentType: string
}

export interface EntityOverlapRow {
	id: number
	caseNumber: string
	documentType: string
	entitySimilarity: number
}

export class ParticipantRepository extends BaseRepository<Participant, NewParticipant> {
	constructor() {
		super(participants)
	}

	async findByDocumentId(documentId: number): Promise<Participant[]> {
		return this.db
			.select()
			.from(participants)
			.where(eq(participants.documentId, documentId))
	}

	async search(opts: {
		role?: string
		name?: string
		caseNumber?: string
		limit?: number
		offset?: number
	}): Promise<{ data: ParticipantWithCase[]; total: number }> {
		const { role, name, caseNumber, limit = 20, offset = 0 } = opts
		const conditions: any[] = []

		if (role) conditions.push(eq(participants.role, role))
		if (name) conditions.push(ilike(participants.normalizedName, `%${name}%`))
		if (caseNumber) conditions.push(ilike(documents.caseNumber, `%${caseNumber}%`))

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined

		const countResult = await this.db
			.select({ count: sql<number>`count(*)` })
			.from(participants)
			.leftJoin(documents, eq(participants.documentId, documents.id))
			.where(whereClause)

		const total = countResult[0]?.count ?? 0

		const data = await this.db
			.select({
				id: participants.id,
				documentId: participants.documentId,
				name: participants.name,
				normalizedName: participants.normalizedName,
				role: participants.role,
				roleConfidence: participants.roleConfidence,
				entityType: participants.entityType,
				mentionCount: participants.mentionCount,
				mentions: participants.mentions,
				clusterId: participants.clusterId,
				relevanceScore: participants.relevanceScore,
				extractionVersion: participants.extractionVersion,
				caseNumber: documents.caseNumber,
				documentType: documents.documentType,
			})
			.from(participants)
			.leftJoin(documents, eq(participants.documentId, documents.id))
			.where(whereClause)
			.orderBy(sql`relevance_score DESC NULLS LAST`)
			.limit(limit)
			.offset(offset)

		return { data: data as ParticipantWithCase[], total }
	}

	async deleteByDocumentId(documentId: number): Promise<void> {
		await this.db
			.delete(participants)
			.where(eq(participants.documentId, documentId))
	}

	async findEntityOverlap(
		targetDocumentId: number,
		limit = 20,
	): Promise<EntityOverlapRow[]> {
		const result = await this.db.execute(
			sql`
				WITH target AS (
					SELECT normalized_name, role
					FROM participants
					WHERE document_id = ${targetDocumentId}
				),
				matches AS (
					SELECT
						p2.document_id,
						SUM(
							CASE p2.role
								WHEN 'judge' THEN 0.4
								WHEN 'magistrate' THEN 0.35
								WHEN 'lawyer' THEN 0.3
								WHEN 'defendant' THEN 0.3
								WHEN 'prosecutor' THEN 0.25
								WHEN 'police_officer' THEN 0.2
								WHEN 'witness' THEN 0.1
								WHEN 'court' THEN 0.15
								WHEN 'court_official' THEN 0.2
								ELSE 0.05
							END
						) AS weighted_sum,
						COUNT(*) AS matched_count
					FROM target t
					JOIN participants p2
						ON t.normalized_name = p2.normalized_name
						AND p2.document_id != ${targetDocumentId}
					GROUP BY p2.document_id
				)
				SELECT
					d.id,
					d.case_number AS "caseNumber",
					d.document_type AS "documentType",
					m.weighted_sum / NULLIF(
						(SELECT COUNT(*) FROM participants WHERE document_id = ${targetDocumentId}) +
						(SELECT COUNT(*) FROM participants WHERE document_id = d.id) -
						m.matched_count,
						0
					) AS "entitySimilarity"
				FROM matches m
				JOIN documents d ON d.id = m.document_id
				ORDER BY "entitySimilarity" DESC
				LIMIT ${limit}
			`,
		)
		return result as unknown as EntityOverlapRow[]
	}
}
