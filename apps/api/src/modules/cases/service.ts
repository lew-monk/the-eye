import { documentRepository, chunkRepository, participantRepository, coreferenceRepository, db } from '@workspace/shared'
import { participants, documents, coreferenceResults, coreferenceClusters, coreferenceMentions } from '@workspace/shared'
import { eq, and } from 'drizzle-orm'

export abstract class CasesService {
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

	static async getMentionContexts(participantId: number, padding = 120) {
		const participant = await participantRepository.findById(participantId)
		if (!participant?.clusterId) return []

		const coref = await coreferenceRepository.findByDocumentId(participant.documentId)
		if (!coref) return []

		const cluster = coref.clusters.find(c => c.clusterIndex === participant.clusterId)
		if (!cluster) return []

		// ── ROLLBACK BLOCK: restore to read from coref.resolvedText ──
		// let text = coref.resolvedText || ''
		// if (!text) {
		// 	const doc = await documentRepository.findById(participant.documentId)
		// 	const fullContent = doc?.fullContent as { content?: string } | null
		// 	text = fullContent?.content || ''
		// }
		// ── END ROLLBACK BLOCK ──

		const doc = await documentRepository.findById(participant.documentId)
		const fullContent = doc?.fullContent as { content?: string } | null
		const text = fullContent?.content || ''

		if (!text) return cluster.mentions.map(m => ({ text: m.text, start: m.startPos, end: m.endPos, context: m.text }))

		return cluster.mentions.map(m => {
			const begin = Math.max(0, m.startPos - padding)
			const finish = Math.min(text.length, m.endPos + padding)
			let excerpt = text.slice(begin, finish)
			if (begin > 0) excerpt = '\u2026' + excerpt
			if (finish < text.length) excerpt = excerpt + '\u2026'
			return { text: m.text, start: m.startPos, end: m.endPos, context: excerpt }
		})
	}

	static async getEntityMentionContexts(
		normalizedName: string,
		caseId: number,
		padding = 120,
		mentionIndex?: number,
	) {
		const baseQuery = db
			.select({
				documentId: participants.documentId,
				filename: documents.filename,
				mentionText: coreferenceMentions.text,
				startPos: coreferenceMentions.startPos,
				endPos: coreferenceMentions.endPos,
				resolvedText: coreferenceResults.resolvedText,
				fullContent: documents.fullContent,
			})
			.from(coreferenceMentions)
			.innerJoin(coreferenceClusters, eq(coreferenceClusters.id, coreferenceMentions.clusterId))
			.innerJoin(coreferenceResults, eq(coreferenceResults.id, coreferenceClusters.resultId))
			.innerJoin(
				participants,
				and(
					eq(participants.clusterId, coreferenceClusters.clusterIndex),
					eq(participants.documentId, coreferenceResults.documentId),
				),
			)
			.innerJoin(documents, eq(documents.id, participants.documentId))
			.where(
				and(
					eq(participants.normalizedName, normalizedName),
					eq(documents.caseId, caseId),
				),
			)
			.orderBy(participants.documentId, coreferenceMentions.startPos)

		const rows = mentionIndex != null
			? await baseQuery.limit(1).offset(mentionIndex)
			: await baseQuery

		return rows.map((r) => {
			// ── ROLLBACK BLOCK: restore to read from resolvedText ──
			// let text = r.resolvedText || ''
			// if (!text) {
			// 	const fc = r.fullContent as { content?: string } | null
			// 	text = fc?.content || ''
			// }
			// ── END ROLLBACK BLOCK ──

			const fc = r.fullContent as { content?: string } | null
			let text = fc?.content || ''
			if (!text) {
				text = r.resolvedText || ''
			}
			const start = r.startPos
			const end = r.endPos

			if (!text) {
				return { text: r.mentionText, start, end, context: r.mentionText, documentId: r.documentId, filename: r.filename }
			}
			console.log(text.slice(start, end))

			const begin = Math.max(0, start - padding)
			const finish = Math.min(text.length, end + padding)
			let excerpt = text.slice(begin, finish)
			if (begin > 0) excerpt = '\u2026' + excerpt
			if (finish < text.length) excerpt = excerpt + '\u2026'
			return { text: r.mentionText, start, end, context: excerpt, documentId: r.documentId, filename: r.filename }
		})
	}
}
