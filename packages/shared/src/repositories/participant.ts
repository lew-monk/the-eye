import { eq, sql, and, ilike, inArray } from 'drizzle-orm'
import { BaseRepository } from './base'
import { participants, documents, type Participant, type NewParticipant } from '../schemas'

export interface ParticipantWithCase extends Participant {
	caseId: number | null
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
				relevanceScore: participants			.relevanceScore,
				extractionVersion: participants.extractionVersion,
				caseId: documents.caseId,
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

	async findCaseEntityOverlap(
		documentId: number,
		caseId: number,
	): Promise<{
		participantId: number
		normalizedName: string
		docCount: number
		totalDocsInCase: number
		mentionCountAcrossCase: number
	}[]> {
		const result = await this.db.execute(
			sql`
				WITH case_docs AS (
					SELECT id FROM documents WHERE case_id = ${caseId}
				),
				case_doc_count AS (
					SELECT COUNT(*)::int AS total FROM case_docs
				),
				target_entities AS (
					SELECT id as participant_id, normalized_name, COALESCE(mention_count, 0) as m_count
					FROM participants
					WHERE document_id = ${documentId}
				),
				overlap AS (
					SELECT
						te.participant_id,
						te.normalized_name,
						te.m_count,
						COUNT(DISTINCT p.document_id) + 1 AS doc_count,
						SUM(COALESCE(p.mention_count, 0)) + te.m_count AS mention_count_total,
						(SELECT total FROM case_doc_count) AS total_docs
					FROM target_entities te
					JOIN participants p
						ON te.normalized_name = p.normalized_name
						AND p.document_id IN (SELECT id FROM case_docs)
						AND p.document_id != ${documentId}
					GROUP BY te.participant_id, te.normalized_name, te.m_count
				)
				SELECT
					participant_id AS "participantId",
					normalized_name AS "normalizedName",
					doc_count AS "docCount",
					total_docs AS "totalDocsInCase",
					mention_count_total AS "mentionCountAcrossCase"
				FROM overlap
			`,
		)
		return result as any
	}

	async findByCaseIdAndNormalizedNames(
		caseId: number,
		names: string[],
	): Promise<Participant[]> {
		const result = await this.db
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
				createdAt: participants.createdAt,
				updatedAt: participants.updatedAt,
			})
			.from(participants)
			.innerJoin(documents, eq(participants.documentId, documents.id))
			.where(
				and(
					eq(documents.caseId, caseId),
					inArray(participants.normalizedName, names),
				),
			)
		return result as Participant[]
	}

	async findCrossCaseEntityOverlap(
		documentId: number,
	): Promise<{
		participantId: number
		normalizedName: string
		matchedCaseId: number
		matchedCaseNumber: string
		docCountInOtherCase: number
		totalMentionsAcrossCases: number
	}[]> {
		const result = await this.db.execute(
			sql`
				WITH target_entities AS (
					SELECT id, normalized_name, COALESCE(mention_count, 0) as m_count
					FROM participants
					WHERE document_id = ${documentId}
				),
				doc_case AS (
					SELECT case_id FROM documents WHERE id = ${documentId} AND case_id IS NOT NULL
				)
				SELECT DISTINCT
					te.id AS "participantId",
					te.normalized_name AS "normalizedName",
					d.case_id::int AS "matchedCaseId",
					d.case_number AS "matchedCaseNumber",
					COUNT(DISTINCT p.document_id) AS "docCountInOtherCase",
					SUM(COALESCE(p.mention_count, 0)) AS "totalMentionsAcrossCases"
				FROM target_entities te
				JOIN participants p ON te.normalized_name = p.normalized_name AND p.document_id != ${documentId}
				JOIN documents d ON p.document_id = d.id AND d.case_id IS NOT NULL
				CROSS JOIN doc_case dc
				WHERE d.case_id != dc.case_id
				GROUP BY te.id, te.normalized_name, d.case_id, d.case_number
			`,
		)
		return result as any
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
		return (result as unknown as EntityOverlapRow[]).map((row) => ({
			...row,
			entitySimilarity: Number(row.entitySimilarity),
		}))
	}
}
