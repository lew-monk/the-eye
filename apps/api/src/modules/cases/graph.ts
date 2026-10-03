import { documentRepository, participantRepository } from '@workspace/shared'
import { documentBodyText, extractDatedEvents, linkReferences, type EventKind, type LinkedReference } from './linker'
import { ChronologyService } from './chronology'
import type { DocumentGraph, DocumentGraphEdge, DocumentGraphNode } from './types'

const EXPLICIT_REF_PATTERNS = [
	/\bas\s+stated\s+in\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _.-]{2,80})/gi,
	/\breferred?\s+to\s+in\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _.-]{2,80})/gi,
	/\bpursuant\s+to\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _.-]{2,80})/gi,
	/\bin\s+accordance\s+with\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _.-]{2,80})/gi,
	/\bsee\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _.-]{2,80}(?:report|affidavit|judgment|order|statement|pleading|brief|motion))/gi,
	/\breference[sd]?\s+(?:in|to)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _.-]{2,80})/gi,
]
export abstract class GraphService {
	static async getReferenceLinks(caseId: number): Promise<
		(LinkedReference & { documentId: number; filename: string })[]
	> {
		const docs = await documentRepository.findByCaseId(caseId)
		const out: (LinkedReference & { documentId: number; filename: string })[] = []

		for (const doc of docs) {
			const text = documentBodyText(doc)
			if (!text) continue
			const parts = await participantRepository.findByDocumentId(doc.id)
			const links = linkReferences(text, parts)
			for (const link of links) {
				out.push({ ...link, documentId: doc.id, filename: doc.filename })
			}
		}

		return out
	}

	static matchDocumentReference(
		refText: string,
		docs: { id: number; filename: string; documentType: string }[],
		sourceId: number,
	): number | null {
		const normalized = refText.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
		if (!normalized) return null

		let best: { id: number; score: number } | null = null
		for (const doc of docs) {
			if (doc.id === sourceId) continue
			const candidates = [
				doc.filename.replace(/\.[^.]+$/, ''),
				doc.documentType.replace(/_/g, ' '),
				doc.filename,
			]
			for (const c of candidates) {
				const cand = c.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
				if (!cand) continue
				if (normalized.includes(cand) || cand.includes(normalized)) {
					const score = Math.min(normalized.length, cand.length) / Math.max(normalized.length, cand.length)
					if (!best || score > best.score) best = { id: doc.id, score }
				} else {
					// token overlap
					const nTokens = new Set(normalized.split(' ').filter(Boolean))
					const cTokens = cand.split(' ').filter(Boolean)
					const overlap = cTokens.filter((t) => nTokens.has(t)).length
					const single = cTokens.length === 1 ? cTokens[0] : undefined
					if (overlap >= 2 || (overlap === 1 && single != null && single.length > 4)) {
						const score = overlap / Math.max(cTokens.length, 1)
						if (!best || score > best.score) best = { id: doc.id, score }
					}
				}
			}
		}
		return best && best.score >= 0.4 ? best.id : null
	}

	static async getDocumentGraph(caseId: number): Promise<DocumentGraph> {
		const docs = await documentRepository.findByCaseId(caseId)
		const nodes: DocumentGraphNode[] = docs.map((d) => {
			const text = documentBodyText(d)
			const fromText = extractDatedEvents(text, 8).map((e) => ({ date: e.date, kind: e.kind }))
			const unique: { date: string; kind: EventKind }[] = []
			for (const item of fromText) {
				if (!unique.some((u) => u.date === item.date)) unique.push(item)
			}
			if (unique.length === 0) {
				const structured = d.structuredData
				const meta = ChronologyService.extractDocumentDate(
					typeof structured === 'object' && structured !== null
						? structured
						: typeof structured === 'string'
							? structured
							: null,
				)
				if (meta) unique.push({ date: meta.date, kind: 'document' })
			}
			return {
				documentId: d.id,
				filename: d.filename,
				documentType: d.documentType,
				dates: unique.slice(0, 5),
			}
		})

		const edges: DocumentGraphEdge[] = []
		const edgeKey = new Set<string>()

		const addEdge = (edge: DocumentGraphEdge) => {
			const key = `${edge.sourceDocumentId}->${edge.targetDocumentId}:${edge.relationType}`
			if (edgeKey.has(key)) return
			edgeKey.add(key)
			edges.push(edge)
		}

		for (const doc of docs) {
			const fullContent = doc.fullContent as { content?: string } | null
			const coref = doc.coreferenceResolvedContent as { content?: string } | string | null
			const text =
				(typeof coref === 'string' ? coref : coref?.content) ||
				fullContent?.content ||
				doc.normalizedText ||
				''

			if (text) {
				for (const pattern of EXPLICIT_REF_PATTERNS) {
					pattern.lastIndex = 0
					let match: RegExpExecArray | null
					while ((match = pattern.exec(text)) !== null) {
						const ref = match[1]?.trim()
						if (!ref) continue
						const targetId = GraphService.matchDocumentReference(ref, docs, doc.id)
						if (targetId != null) {
							addEdge({
								sourceDocumentId: doc.id,
								targetDocumentId: targetId,
								relationType: 'explicit_reference',
								label: ref.slice(0, 80),
							})
						}
					}
				}
			}
		}

		// Implicit subset: document type hierarchy within case
		const typeRank: Record<string, number> = {
			police_report: 1,
			incident_report: 1,
			witness_statement: 2,
			affidavit: 3,
			pleading: 4,
			motion: 4,
			brief: 5,
			court_order: 6,
			judgment: 7,
			administrative_decision: 7,
		}

		const sortedByType = [...docs].sort(
			(a, b) => (typeRank[a.documentType] ?? 50) - (typeRank[b.documentType] ?? 50),
		)
		for (let i = 0; i < sortedByType.length - 1; i++) {
			const a = sortedByType[i]
			const b = sortedByType[i + 1]
			if (!a || !b) continue
			const ra = typeRank[a.documentType]
			const rb = typeRank[b.documentType]
			if (ra != null && rb != null && ra < rb) {
				addEdge({
					sourceDocumentId: b.id,
					targetDocumentId: a.id,
					relationType: 'implicit_subset',
					label: `${b.documentType} builds on ${a.documentType}`,
				})
			}
		}

		return { nodes, edges }
	}

}
