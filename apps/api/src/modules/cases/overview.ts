import { documentRepository, chunkRepository, participantRepository } from '@workspace/shared'
import { EntityService } from '../entities/service'
import type { CaseEntity } from './types'

export abstract class CaseOverviewService {
	static async getCaseChunks(caseId: number) {
		const docs = await documentRepository.findByCaseId(caseId)
		const allChunks: Array<{
			id: number
			documentId: number
			filename: string
			chunkIndex: number
			text: string
			positionWeight: number | null
		}> = []

		for (const doc of docs) {
			const chunks = await chunkRepository.findByDocumentId(doc.id)
			for (const c of chunks) {
				if (c.positionWeight != null && c.text != null) {
					allChunks.push({
						id: c.id,
						documentId: c.documentId,
						filename: doc.filename,
						chunkIndex: c.chunkIndex,
						text: c.text,
						positionWeight: c.positionWeight,
					})
				}
			}
		}

		allChunks.sort((a, b) => (b.positionWeight ?? 0) - (a.positionWeight ?? 0))
		return allChunks.slice(0, 50)
	}

	static async getCaseEntities(caseId: number): Promise<CaseEntity[]> {
		const docs = await documentRepository.findByCaseId(caseId)
		const totalDocsInCase = docs.length
		const byName = new Map<
			string,
			{
				id: number
				name: string
				normalizedName: string
				role: string
				roleConfidence: number | null
				mentionCount: number
				relevanceScore: number | null
				mentions: string[] | null
				documentIds: Set<number>
				roleCounts: Map<string, number>
			}
		>()

		for (const doc of docs) {
			const parts = await participantRepository.findByDocumentId(doc.id)
			for (const p of parts) {
				const key = p.normalizedName
				const existing = byName.get(key)
				if (!existing) {
					byName.set(key, {
						id: p.id,
						name: p.name,
						normalizedName: p.normalizedName,
						role: p.role,
						roleConfidence: p.roleConfidence,
						mentionCount: p.mentionCount ?? 0,
						relevanceScore: p.relevanceScore,
						mentions: p.mentions,
						documentIds: new Set([doc.id]),
						roleCounts: new Map([[p.role || 'other', 1]]),
					})
				} else {
					existing.mentionCount += p.mentionCount ?? 0
					existing.documentIds.add(doc.id)
					const role = p.role || 'other'
					existing.roleCounts.set(role, (existing.roleCounts.get(role) ?? 0) + 1)
					const bestRole = [...existing.roleCounts.entries()].sort((a, b) => b[1] - a[1])[0]
					if (bestRole) existing.role = bestRole[0]
					if ((p.relevanceScore ?? 0) > (existing.relevanceScore ?? 0)) {
						existing.relevanceScore = p.relevanceScore
						existing.id = p.id
						existing.name = p.name
						existing.roleConfidence = p.roleConfidence
						existing.mentions = p.mentions
					}
				}
			}
		}

		const result: CaseEntity[] = []
		for (const entity of byName.values()) {
			const confidence = await EntityService.getConfidence(entity.normalizedName)
			const totalApp = confidence.roles.reduce((s, r) => s + r.count, 0)
			const roleBreakdown = confidence.roles.map((r) => ({
				role: r.role,
				count: r.count,
				confidence: totalApp > 0 ? Math.round((r.count / totalApp) * 100) : 0,
			}))

			result.push({
				id: entity.id,
				name: entity.name,
				normalizedName: entity.normalizedName,
				role: entity.role,
				roleConfidence: entity.roleConfidence,
				mentionCount: entity.mentionCount,
				relevanceScore: entity.relevanceScore,
				mentions: entity.mentions,
				documentCount: entity.documentIds.size,
				totalDocsInCase,
				confidence: {
					score: confidence.overallScore,
					roleConsistency: confidence.roleConsistency,
					documentCoverage: confidence.documentCoverage,
					flags: confidence.flags,
					roleBreakdown,
				},
			})
		}

		result.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
		return result
	}

}
