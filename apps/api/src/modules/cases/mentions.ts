import { documentRepository, participantRepository, coreferenceRepository, db } from '@workspace/shared'
import { participants, documents, coreferenceResults, coreferenceClusters, coreferenceMentions } from '@workspace/shared'
import { eq, and } from 'drizzle-orm'
import { jsonObjectContent } from '../../lib/json'

export abstract class CaseMentionService {
	static mentionSourceText(resolvedText?: string | null, fullContent?: object | string | null): string {
		if (resolvedText) return resolvedText
		if (typeof fullContent === 'string') return fullContent
		return jsonObjectContent(fullContent)
	}

	static excerptMention(
		text: string,
		start: number,
		end: number,
		mentionText: string,
		padding = 120,
	): { start: number; end: number; context: string } {
		let s = start
		let e = end
		const slice = text.slice(start, end)
		if (mentionText && slice !== mentionText) {
			const found = text.indexOf(mentionText)
			if (found >= 0) {
				s = found
				e = found + mentionText.length
			}
		}

		const begin = Math.max(0, s - padding)
		const finish = Math.min(text.length, e + padding)
		let excerpt = text.slice(begin, finish)
		if (begin > 0) excerpt = '\u2026' + excerpt
		if (finish < text.length) excerpt = excerpt + '\u2026'
		return { start: s, end: e, context: excerpt }
	}

	static async addManualParticipant(
		caseId: number,
		input: { name: string; role?: string; documentId?: number },
	) {
		const name = input.name.trim()
		if (!name) throw new Error('Name is required')

		const docs = await documentRepository.findByCaseId(caseId)
		if (docs.length === 0) throw new Error('Case has no documents')

		const doc = input.documentId
			? docs.find((d) => d.id === input.documentId)
			: docs[0]
		if (!doc) throw new Error('Document is not in this case')

		const normalizedName = name
			.toLowerCase()
			.replace(/[^\w\s-]/g, '')
			.replace(/\s+/g, ' ')
			.trim()

		return participantRepository.create({
			documentId: doc.id,
			name,
			normalizedName,
			role: input.role || 'other',
			roleConfidence: 1,
			entityType: 'PERSON',
			mentionCount: 0,
			mentions: [],
			relevanceScore: 0.5,
		})
	}

	static async getMentionContexts(participantId: number, padding = 120) {
		const participant = await participantRepository.findById(participantId)
		if (!participant?.clusterId) return []

		const coref = await coreferenceRepository.findByDocumentId(participant.documentId)
		if (!coref) return []

		const cluster = coref.clusters.find(c => c.clusterIndex === participant.clusterId)
		if (!cluster) return []

		const doc = await documentRepository.findById(participant.documentId)
		const text = CaseMentionService.mentionSourceText(
			coref.resolvedText,
			typeof doc?.fullContent === 'object' && doc.fullContent !== null ? doc.fullContent : null,
		)

		if (!text) return cluster.mentions.map(m => ({ text: m.text, start: m.startPos, end: m.endPos, context: m.text }))

		return cluster.mentions.map(m => {
			const excerpt = CaseMentionService.excerptMention(text, m.startPos, m.endPos, m.text, padding)
			return { text: m.text, start: excerpt.start, end: excerpt.end, context: excerpt.context }
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
			const text = CaseMentionService.mentionSourceText(
				r.resolvedText,
				typeof r.fullContent === 'object' && r.fullContent !== null ? r.fullContent : null,
			)
			const start = r.startPos
			const end = r.endPos

			if (!text) {
				return { text: r.mentionText, start, end, context: r.mentionText, documentId: r.documentId, filename: r.filename }
			}

			const excerpt = CaseMentionService.excerptMention(text, start, end, r.mentionText, padding)
			return {
				text: r.mentionText,
				start: excerpt.start,
				end: excerpt.end,
				context: excerpt.context,
				documentId: r.documentId,
				filename: r.filename,
			}
		})
	}
}
