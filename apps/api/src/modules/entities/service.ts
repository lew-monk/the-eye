import { db } from '@workspace/shared'
import { participants, documents, coreferenceResults, coreferenceClusters, coreferenceMentions } from '@workspace/shared'
import { eq, and, sql } from 'drizzle-orm'
import { participantRepository, documentRepository, coreferenceRepository } from '@workspace/shared'

interface EntityAppearance {
	participantId: number
	documentId: number
	filename: string
	caseId: number | null
	caseNumber: string | null
	documentType: string
	role: string
	roleConfidence: number | null
	mentionCount: number
	relevanceScore: number | null
	mentions: string[] | null
	clusterId: number | null
}

interface RoleDistribution {
	role: string
	count: number
}

interface CoOccurring {
	normalizedName: string
	displayName: string
	docCount: number
	roles: string[]
}

interface MentionContextItem {
	participantId: number
	documentId: number
	participantName: string
	allMentions: string[]
	caseId: number | null
	caseNumber: string | null
	filename: string
	mentions: { text: string; start: number; end: number; context: string }[]
}

interface ConfidenceResult {
	overallScore: number
	roleConsistency: number
	documentCoverage: number
	roles: { role: string; count: number; documents: number }[]
	flags: string[]
}

export interface EntityDossier {
	normalizedName: string
	displayName: string
	totalMentions: number
	totalDocuments: number
	totalCases: number
	roleDistribution: { role: string; count: number; percentage: number }[]
	primaryRole: string
	appearances: EntityAppearance[]
	coOccurringEntities: CoOccurring[]
	mentionContexts: MentionContextItem[]
	confidence: ConfidenceResult
}

export abstract class EntityService {
	static async getDossier(normalizedName: string): Promise<EntityDossier | null> {
		const appearances = await db
			.select({
				participantId: participants.id,
				documentId: participants.documentId,
				name: participants.name,
				filename: documents.filename,
				caseId: documents.caseId,
				caseNumber: documents.caseNumber,
				documentType: documents.documentType,
				role: participants.role,
				roleConfidence: participants.roleConfidence,
				mentionCount: participants.mentionCount,
				relevanceScore: participants.relevanceScore,
				mentions: participants.mentions,
				clusterId: participants.clusterId,
			})
			.from(participants)
			.innerJoin(documents, eq(participants.documentId, documents.id))
			.where(eq(participants.normalizedName, normalizedName))
			.orderBy(sql`relevance_score DESC NULLS LAST`)

		if (appearances.length === 0) return null

		const displayName = appearances[0]?.name || normalizedName

		const uniqueDocs = new Set(appearances.map((a: any) => a.documentId))
		const uniqueCases = new Set(
			appearances.filter((a: any) => a.caseId != null).map((a: any) => a.caseId)
		)
		const totalMentions = appearances.reduce(
			(sum, a: any) => sum + (a.mentionCount ?? 0), 0
		)

		const roleCounts = new Map<string, number>()
		for (const a of appearances) {
			const role = (a as any).role || 'other'
			roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1)
		}
		const roleDistribution: { role: string; count: number; percentage: number }[] =
			Array.from(roleCounts.entries())
				.sort((a, b) => b[1] - a[1])
				.map(([role, count]) => ({
					role,
					count,
					percentage: Math.round((count / appearances.length) * 100),
				}))

		const primaryRole = roleDistribution[0]?.role ?? 'other'

		const coOccurring = await EntityService.getCoOccurringEntities(normalizedName)

		const mentionContexts = await EntityService.getMentionContextsForName(normalizedName)

		const confidence = await EntityService.getConfidence(normalizedName)

		return {
			normalizedName,
			displayName,
			totalMentions,
			totalDocuments: uniqueDocs.size,
			totalCases: uniqueCases.size,
			roleDistribution,
			primaryRole,
			appearances: appearances.map((a: any) => ({
				participantId: a.participantId,
				documentId: a.documentId,
				filename: a.filename,
				caseId: a.caseId,
				caseNumber: a.caseNumber,
				documentType: a.documentType,
				role: a.role,
				roleConfidence: a.roleConfidence,
				mentionCount: a.mentionCount ?? 0,
				relevanceScore: a.relevanceScore,
				mentions: a.mentions,
				clusterId: a.clusterId,
			})),
			coOccurringEntities: coOccurring,
			mentionContexts,
			confidence,
		}
	}

	private static async getCoOccurringEntities(
		normalizedName: string,
	): Promise<CoOccurring[]> {
		const result = await db.execute(
			sql`
				SELECT
					p2.normalized_name AS "normalizedName",
					p2.name AS "displayName",
					COUNT(DISTINCT p2.document_id)::int AS "docCount",
					array_agg(DISTINCT p2.role) AS "roles"
				FROM participants p1
				JOIN participants p2
					ON p1.document_id = p2.document_id
					AND p1.normalized_name != p2.normalized_name
				JOIN documents d ON p1.document_id = d.id
				WHERE p1.normalized_name = ${normalizedName}
				GROUP BY p2.normalized_name, p2.name
				ORDER BY "docCount" DESC
				LIMIT 20
			`,
		)
		return (result as any[]).map((r: any) => ({
			normalizedName: r.normalizedName,
			displayName: r.displayName,
			docCount: r.docCount,
			roles: r.roles,
		}))
	}

	private static async getMentionContextsForName(
		normalizedName: string,
		padding = 200,
	): Promise<MentionContextItem[]> {
		const parts = await participantRepository.search({
			name: normalizedName,
			limit: 100,
		})

		const results: MentionContextItem[] = []

		// ── ROLLBACK BLOCK: restore to use coref cluster-based extraction ──
		// for (const p of parts.data) {
		// 	if (!p.clusterId) continue
		//
		// 	const coref = await coreferenceRepository.findByDocumentId(p.documentId)
		// 	if (!coref) continue
		//
		// 	const cluster = coref.clusters.find((c) => c.clusterIndex === p.clusterId)
		// 	if (!cluster) continue
		//
		// 	let text = coref.resolvedText || ''
		// 	if (!text) {
		// 		const doc = await documentRepository.findById(p.documentId)
		// 		const fullContent = doc?.fullContent as { content?: string } | null
		// 		text = fullContent?.content || ''
		// 	}
		//
		// 	const docInfo = await documentRepository.findById(p.documentId)
		//
		// 	const contexts = cluster.mentions.map((m) => {
		// 		const begin = Math.max(0, m.startPos - padding)
		// 		const finish = Math.min(text.length, m.endPos + padding)
		// 		let excerpt = text.slice(begin, finish)
		// 		if (begin > 0) excerpt = '\u2026' + excerpt
		// 		if (finish < text.length) excerpt = excerpt + '\u2026'
		// 		return { text: m.text, start: m.startPos, end: m.endPos, context: excerpt }
		// 	})
		//
		// 	if (contexts.length > 0) {
		// 		results.push({
		// 			participantId: p.id,
		// 			documentId: p.documentId,
		// 			filename: docInfo?.filename ?? `Doc-${p.documentId}`,
		// 			mentions: contexts,
		// 		})
		// 	}
		// }
		// ── END ROLLBACK BLOCK ──

		for (const p of parts.data) {
			const doc = await documentRepository.findById(p.documentId)
			if (!doc) continue

			const fullContent = doc.fullContent as { content?: string } | null
			const text = fullContent?.content || ''
			if (!text) continue

			const participantMentions = p.mentions || []
			if (participantMentions.length === 0) continue

			const contexts: { text: string; start: number; end: number; context: string }[] = []

			for (const mention of participantMentions) {
				let fromIndex = 0
				while (fromIndex < text.length) {
					const pos = text.indexOf(mention, fromIndex)
					if (pos === -1) break

					const begin = Math.max(0, pos - padding)
					const finish = Math.min(text.length, pos + mention.length + padding)
					let excerpt = text.slice(begin, finish)
					if (begin > 0) excerpt = '\u2026' + excerpt
					if (finish < text.length) excerpt = excerpt + '\u2026'

					contexts.push({
						text: text.slice(pos, pos + mention.length),
						start: pos,
						end: pos + mention.length,
						context: excerpt,
					})

					fromIndex = pos + 1
				}
			}

			if (contexts.length > 0) {
				results.push({
					participantId: p.id,
					documentId: p.documentId,
					participantName: p.name,
					allMentions: participantMentions,
					caseId: p.caseId,
					caseNumber: p.caseNumber,
					filename: doc.filename ?? `Doc-${p.documentId}`,
					mentions: contexts,
				})
			}
		}

		return results
	}

	static async getConfidence(normalizedName: string): Promise<ConfidenceResult> {
		const roleResult = await db.execute(
			sql`
				SELECT
					p.role,
					COUNT(*)::int AS "count",
					COUNT(DISTINCT p.document_id)::int AS "documents"
				FROM participants p
				WHERE p.normalized_name = ${normalizedName}
				GROUP BY p.role
				ORDER BY "count" DESC
			`,
		)

		const roles = (roleResult as any[]).map((r: any) => ({
			role: r.role,
			count: r.count,
			documents: r.documents,
		}))

		const totalAppearances = roles.reduce((sum, r) => sum + r.count, 0)
		const uniqueDocs = roles.reduce((sum, r) => sum + r.documents, 0)

		const totalDocsResult = await db.execute(
			sql`
				SELECT COUNT(DISTINCT p.document_id)::int AS total
				FROM participants p
				JOIN documents d ON p.document_id = d.id
				WHERE p.normalized_name = ${normalizedName}
			`,
		)
		const totalDocs = (totalDocsResult as any[])[0]?.total ?? 0

		const totalDocsInCaseResult = await db.execute(
			sql`
				SELECT
					d.case_id,
					COUNT(DISTINCT all_docs.id)::int AS case_total
				FROM (
					SELECT DISTINCT p.document_id, d2.case_id
					FROM participants p
					JOIN documents d2 ON p.document_id = d2.id
					WHERE p.normalized_name = ${normalizedName} AND d2.case_id IS NOT NULL
				) AS entity_docs
				JOIN documents d ON d.id = entity_docs.document_id
				JOIN documents all_docs ON all_docs.case_id = d.case_id
				GROUP BY d.case_id
			`,
		)

		let documentCoverage = 0
		const caseResults = totalDocsInCaseResult as any[]
		if (caseResults.length > 0) {
			const coverages = caseResults.map((cr: any) => {
				const docsPerCase = roles.reduce((sum, r) => {
					return sum + (r.documents > 0 ? r.documents / caseResults.length : 0)
				}, 0)
				return Math.min(1, docsPerCase / cr.case_total)
			})
			documentCoverage =
				coverages.reduce((a: number, b: number) => a + b, 0) / coverages.length
		} else if (totalDocs > 0) {
			const docResult = await db.execute(
				sql`SELECT COUNT(*)::int AS total FROM documents`
			)
			const allDocs = (docResult as any[])[0]?.total ?? totalDocs
			documentCoverage = totalDocs / Math.max(allDocs, 1)
		}

		const primaryRole = roles[0]
		const primaryCount = primaryRole?.count ?? 0
		const roleConsistency =
			totalAppearances > 0 ? primaryCount / totalAppearances : 0

		const flags: string[] = []

		for (const r of roles) {
			if (r.count < primaryCount && r.count > 0) {
				const ratio = r.count / primaryCount
				if (ratio < 0.5) {
					flags.push(
						`Role "${r.role}" appears ${r.count} time(s) vs "${primaryRole?.role}" at ${primaryCount} — possible outlier`,
					)
				}
			}
		}

		if (documentCoverage < 0.3 && totalDocs > 1) {
			flags.push(
				`Low document coverage (${Math.round(documentCoverage * 100)}%) — entity may be under-extracted`,
			)
		}

		if (roleConsistency < 0.7 && roles.length > 1) {
			flags.push(
				`Low role consensus (${Math.round(roleConsistency * 100)}%) — entity appears in multiple roles`,
			)
		}

		const overallScore = Math.round(
			(roleConsistency * 0.6 + Math.min(documentCoverage, 1) * 0.4) * 100,
		)

		return {
			overallScore,
			roleConsistency: Math.round(roleConsistency * 100),
			documentCoverage: Math.round(documentCoverage * 100),
			roles,
			flags,
		}
	}
}
