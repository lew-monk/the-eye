import { documentRepository, participantRepository, caseRelationRepository } from '@workspace/shared'
import type { NewCaseRelation, NewParticipant } from '@workspace/shared'
import type { ParticipantIngest } from './model'
import { recalibrateRelevance } from './recalibrate'

export abstract class ParticipantsService {
	static async store(documentId: number, participants: ParticipantIngest[], extractionVersion: number) {
		const document = await documentRepository.findById(documentId)
		if (!document) return null

		const rows: NewParticipant[] = participants.map((p) => ({
			name: p.name,
			normalizedName: p.normalizedName,
			role: p.role,
			documentId,
			extractionVersion,
			roleConfidence: p.roleConfidence,
			entityType: p.entityType ?? null,
			mentionCount: p.mentionCount,
			mentions: p.mentions,
			clusterId: p.clusterId,
			relevanceScore: p.relevanceScore,
		}))

		await participantRepository.deleteByDocumentId(documentId)
		const inserted = await participantRepository.createMany(rows)

		await documentRepository.updateById(documentId, {
			extractionVersion,
		})

		await documentRepository.addProcessingLog({
			documentId,
			action: 'participants_extracted',
			details: {
				count: inserted.length,
				version: extractionVersion,
			},
		})

		if (document.caseId) {
			const overlap = await participantRepository.findCaseEntityOverlap(documentId, document.caseId)
			const overlapByName = new Map(overlap.map((o) => [o.normalizedName, o]))
			const updatedIds = new Set<number>()

			for (const p of inserted) {
				const o = overlapByName.get(p.normalizedName)
				const docCount = o?.docCount ?? 1
				const totalDocs = o?.totalDocsInCase ?? 1
				const score = recalibrateRelevance(docCount, totalDocs, p.relevanceScore)

				await participantRepository.updateById(p.id, {
					relevanceScore: score,
				})
				updatedIds.add(p.id)
			}

			const overlappingNames = Array.from(overlapByName.keys())
			if (overlappingNames.length > 0) {
				const allAffected = await participantRepository.findByCaseIdAndNormalizedNames(
					document.caseId,
					overlappingNames,
				)

				for (const p of allAffected) {
					if (updatedIds.has(p.id)) continue

					const o = overlapByName.get(p.normalizedName)
					if (!o) continue

					const score = recalibrateRelevance(o.docCount, o.totalDocsInCase, p.relevanceScore)

					await participantRepository.updateById(p.id, {
						relevanceScore: score,
					})
					updatedIds.add(p.id)
				}
			}

			await documentRepository.addProcessingLog({
				documentId,
				action: 'participants_recalibrated',
				details: {
					caseId: document.caseId,
					overlappingEntities: overlap.length,
					totalParticipants: inserted.length,
					bidiUpdates: updatedIds.size - inserted.length,
				},
			})

			const crossCaseOverlaps = await participantRepository.findCrossCaseEntityOverlap(documentId)
			const seenPairs = new Set<string>()
			let relationCount = 0

			for (const overlap of crossCaseOverlaps) {
				const pairKey =
					document.caseId < overlap.matchedCaseId
						? `${document.caseId}-${overlap.matchedCaseId}-${overlap.normalizedName}`
						: `${overlap.matchedCaseId}-${document.caseId}-${overlap.normalizedName}`

				if (seenPairs.has(pairKey)) continue
				seenPairs.add(pairKey)

				const exists = await caseRelationRepository.findExistingRelation(
					document.caseId,
					overlap.matchedCaseId,
					overlap.normalizedName,
				)
				if (exists) continue

				const [sourceId, targetId] =
					document.caseId <= overlap.matchedCaseId
						? [document.caseId, overlap.matchedCaseId]
						: [overlap.matchedCaseId, document.caseId]

				const relation: NewCaseRelation = {
					sourceCaseId: sourceId,
					targetCaseId: targetId,
					relationType: 'shared_entity',
					entityName: overlap.normalizedName,
					strength: overlap.docCountInOtherCase,
					metadata: {
						sourceDocumentId: documentId,
						matchedCaseNumber: overlap.matchedCaseNumber,
						totalMentionsAcrossCases: overlap.totalMentionsAcrossCases,
					},
				}
				await caseRelationRepository.create(relation)
				relationCount++
			}

			if (relationCount > 0) {
				await documentRepository.addProcessingLog({
					documentId,
					action: 'cross_case_relations_created',
					details: {
						count: relationCount,
						totalCrossCaseEntities: crossCaseOverlaps.length,
					},
				})
			}
		}

		return { count: inserted.length }
	}
}
