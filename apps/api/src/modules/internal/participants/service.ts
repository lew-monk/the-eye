import { documentRepository, participantRepository, caseRelationRepository } from '@workspace/shared'

export abstract class ParticipantsService {
	static async store(documentId: number, participants: any[], extractionVersion: number) {
		const document = await documentRepository.findById(documentId)
		if (!document) return null

		const rows = participants.map((p) => ({
			...p,
			documentId,
			extractionVersion,
		}))

		await participantRepository.deleteByDocumentId(documentId)
		const inserted = await participantRepository.createMany(rows)

		await documentRepository.updateById(documentId, {
			extractionVersion,
		} as any)

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

			const recalibrate = (docCount: number, totalDocs: number, baseScore: number | null) => {
				const base = baseScore ?? 0
				if (totalDocs <= 1) return base
				const bonus = ((docCount - 1) / totalDocs) * 0.5
				return Math.min(1, base + bonus)
			}

			for (const p of inserted) {
				const o = overlapByName.get(p.normalizedName)
				const docCount = o?.docCount ?? 1
				const totalDocs = o?.totalDocsInCase ?? 1
				const score = recalibrate(docCount, totalDocs, p.relevanceScore)

				await participantRepository.updateById(p.id, {
					relevanceScore: score,
				} as any)
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

					const score = recalibrate(o.docCount, o.totalDocsInCase, p.relevanceScore)

					await participantRepository.updateById(p.id, {
						relevanceScore: score,
					} as any)
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

				await caseRelationRepository.create({
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
				} as any)
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
