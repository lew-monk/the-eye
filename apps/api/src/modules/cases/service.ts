import { documentRepository, chunkRepository, participantRepository, coreferenceRepository, db } from '@workspace/shared'
import { participants, documents, coreferenceResults, coreferenceClusters, coreferenceMentions } from '@workspace/shared'
import { eq, and } from 'drizzle-orm'
import { EntityService } from '../entities/service'
import {
	documentBodyText,
	entitiesNearEvent,
	extractDatedEvents,
	linkReferences,
	summarizeEvent,
	type EventKind,
	type LinkedReference,
	type ParticipantHint,
} from './linker'

export interface CaseEntityConfidence {
	score: number
	roleConsistency: number
	documentCoverage: number
	flags: string[]
	roleBreakdown: { role: string; count: number; confidence: number }[]
}

export interface CaseEntity {
	id: number
	name: string
	normalizedName: string
	role: string
	roleConfidence: number | null
	mentionCount: number
	relevanceScore: number | null
	mentions: string[] | null
	documentCount: number
	totalDocsInCase: number
	confidence: CaseEntityConfidence
}

export interface DocumentGraphNode {
	documentId: number
	filename: string
	documentType: string
	dates: { date: string; kind: EventKind }[]
}

export interface DocumentGraphEdge {
	sourceDocumentId: number
	targetDocumentId: number
	relationType: 'explicit_reference' | 'implicit_subset'
	label: string
}

export interface DocumentGraph {
	nodes: DocumentGraphNode[]
	edges: DocumentGraphEdge[]
}

export type CaseNetworkNodeKind =
	| 'case'
	| 'document'
	| 'entity'
	| 'role'
	| 'signal'
	| 'similar_case'

export type IntelligenceSignalType =
	| 'role_variance'
	| 'surge'
	| 'drop'
	| 'unresolved'
	| 'similar'
export type NetworkFocusType = 'case' | 'entity' | 'document' | 'role'

export type CaseNetworkEdgeKind =
	| 'has_document'
	| 'has_role'
	| 'has_entity'
	| 'mentioned_in'
	| 'doc_ref'
	| 'in_case'
	| 'co_occurs'
	| 'connected_case'
	| 'has_signal'
	| 'about'
	| 'similar_to'

export interface NetworkFocus {
	type: NetworkFocusType
	id: string
	caseId?: number
}

export interface CaseNetworkNode {
	id: string
	kind: CaseNetworkNodeKind
	label: string
	sublabel?: string
	role?: string
	weight: number
	mentionCount?: number
	documentCount?: number
	documentType?: string
	caseId?: number
	documentId?: number
	normalizedName?: string
	signal?: IntelligenceSignalType
	detail?: string
}

export interface CaseNetworkEdge {
	source: string
	target: string
	kind: CaseNetworkEdgeKind
	label?: string
}

export interface CaseNetwork {
	focusId: string
	focusType: NetworkFocusType
	caseId: number
	caseNumber: string
	title: string
	caseType: string
	status: string
	nodes: CaseNetworkNode[]
	edges: CaseNetworkEdge[]
	totals: {
		entities: number
		roles: number
		documents: number
		cases: number
		links: number
		hiddenEntities: number
	}
}

export interface ChronologyEvent {
	id: string
	documentId: number
	filename: string
	documentType: string
	date: string
	dateSource: string
	kind: EventKind
	quote: string | null
	summary: string
	entities: { normalizedName: string; name: string; role: string; mentionCount: number }[]
	unresolvedRefs: string[]
}

export interface ChronologyPage {
	events: ChronologyEvent[]
	totalEvents: number
	totalDates: number
}

export interface RoleVarianceFlag {
	normalizedName: string
	displayName: string
	roles: { role: string; documentIds: number[]; count: number }[]
	primaryRole: string
	flag: string
}

export interface EntityTrajectoryPoint {
	documentId: number
	filename: string
	documentType: string
	date: string | null
	mentionCount: number
	role: string
}

export interface EntityTrajectory {
	normalizedName: string
	displayName: string
	points: EntityTrajectoryPoint[]
}

const DATE_FIELD_KEYS = [
	'date',
	'Date',
	'documentDate',
	'DocumentDate',
	'filingDate',
	'FilingDate',
	'issueDate',
	'IssueDate',
	'judgmentDate',
	'JudgmentDate',
	'orderDate',
	'OrderDate',
	'incidentDate',
	'IncidentDate',
	'signedDate',
	'SignedDate',
	'effectiveDate',
	'EffectiveDate',
]

const ISO_DATE_RE = /\b(20\d{2}|19\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/
const US_DATE_RE = /\b(0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])[/-](20\d{2}|19\d{2})\b/
const LONG_DATE_RE =
	/\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(?:20\d{2}|19\d{2}))\b/i

const EXPLICIT_REF_PATTERNS = [
	/\bas\s+stated\s+in\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _.-]{2,80})/gi,
	/\breferred?\s+to\s+in\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _.-]{2,80})/gi,
	/\bpursuant\s+to\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _.-]{2,80})/gi,
	/\bin\s+accordance\s+with\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _.-]{2,80})/gi,
	/\bsee\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _.-]{2,80}(?:report|affidavit|judgment|order|statement|pleading|brief|motion))/gi,
	/\breference[sd]?\s+(?:in|to)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _.-]{2,80})/gi,
]

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

	static extractDocumentDate(
		structuredData: unknown,
		fallbackCreatedAt?: Date | string | null,
	): { date: string; source: string } | null {
		const fromStructured = CasesService.findDateInValue(structuredData, 'structuredData')
		if (fromStructured) return fromStructured

		if (fallbackCreatedAt) {
			const d = fallbackCreatedAt instanceof Date
				? fallbackCreatedAt
				: new Date(fallbackCreatedAt)
			if (!Number.isNaN(d.getTime())) {
				return { date: d.toISOString().slice(0, 10), source: 'createdAt' }
			}
		}
		return null
	}

	private static findDateInValue(
		value: unknown,
		path: string,
		depth = 0,
	): { date: string; source: string } | null {
		if (value == null || depth > 6) return null

		if (typeof value === 'string') {
			const parsed = CasesService.parseDateString(value)
			if (parsed) return { date: parsed, source: path }
			return null
		}

		if (typeof value === 'object' && !Array.isArray(value)) {
			const obj = value as Record<string, unknown>

			// Azure DI style: { fieldName: { valueDate: "..." } } or { valueString: "..." }
			for (const key of DATE_FIELD_KEYS) {
				if (!(key in obj)) continue
				const field = obj[key]
				if (typeof field === 'string') {
					const parsed = CasesService.parseDateString(field)
					if (parsed) return { date: parsed, source: `${path}.${key}` }
				}
				if (field && typeof field === 'object') {
					const f = field as Record<string, unknown>
					const candidates = [f.valueDate, f.content, f.valueString, f.value]
					for (const c of candidates) {
						if (typeof c === 'string') {
							const parsed = CasesService.parseDateString(c)
							if (parsed) return { date: parsed, source: `${path}.${key}` }
						}
					}
				}
			}

			if (obj.fields && typeof obj.fields === 'object') {
				const nested = CasesService.findDateInValue(obj.fields, `${path}.fields`, depth + 1)
				if (nested) return nested
			}

			for (const [k, v] of Object.entries(obj)) {
				if (DATE_FIELD_KEYS.includes(k)) continue
				const nested = CasesService.findDateInValue(v, `${path}.${k}`, depth + 1)
				if (nested) return nested
			}
		}

		if (Array.isArray(value)) {
			for (let i = 0; i < value.length; i++) {
				const nested = CasesService.findDateInValue(value[i], `${path}[${i}]`, depth + 1)
				if (nested) return nested
			}
		}

		return null
	}

	private static parseDateString(raw: string): string | null {
		const s = raw.trim()
		if (!s) return null

		const iso = s.match(ISO_DATE_RE)
		if (iso) {
			const [, y, m, d] = iso
			return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
		}

		const us = s.match(US_DATE_RE)
		if (us) {
			const [, m, d, y] = us
			return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
		}

		const long = s.match(LONG_DATE_RE)
		if (long) {
			const d = new Date(long[1])
			if (!Number.isNaN(d.getTime())) {
				return d.toISOString().slice(0, 10)
			}
		}

		// valueDate already ISO
		if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
			const d = new Date(s)
			if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
		}

		return null
	}

	static async getDocumentChronology(
		caseId: number,
		opts: { maxDates?: number } = {},
	): Promise<ChronologyPage> {
		const docs = await documentRepository.findByCaseId(caseId)
		const staged: {
			doc: (typeof docs)[number]
			parts: Awaited<ReturnType<typeof participantRepository.findByDocumentId>>
			hints: ParticipantHint[]
			text: string
			raw: { date: string; kind: ChronologyEvent['kind']; quote: string | null; start: number; source: string }[]
		}[] = []

		for (const doc of docs) {
			const parts = (await participantRepository.findByDocumentId(doc.id)) ?? []
			const hints: ParticipantHint[] = parts.map((p) => ({
				name: p.name,
				normalizedName: p.normalizedName,
				role: p.role,
				mentions: p.mentions,
				mentionCount: p.mentionCount,
			}))
			const text = documentBodyText(doc)
			const textEvents = text ? extractDatedEvents(text) : []
			const raw = textEvents.length
				? textEvents.map((ev) => ({
						date: ev.date,
						kind: ev.kind,
						quote: ev.quote,
						start: ev.start,
						source: 'document_text',
					}))
				: (() => {
						const extracted = CasesService.extractDocumentDate(doc.structuredData)
						return extracted
							? [{ date: extracted.date, kind: 'document' as const, quote: null, start: 0, source: extracted.source }]
							: []
					})()
			if (raw.length) staged.push({ doc, parts, hints, text, raw })
		}

		const allDates = [...new Set(staged.flatMap((s) => s.raw.map((r) => r.date)))].sort()
		const keepDates = new Set(
			opts.maxDates != null && opts.maxDates > 0
				? allDates.slice(-opts.maxDates)
				: allDates,
		)
		const totalEvents = staged.reduce((n, s) => n + s.raw.length, 0)

		const events: ChronologyEvent[] = []
		for (const { doc, parts, hints, text, raw } of staged) {
			const needed = raw.filter((r) => keepDates.has(r.date))
			if (!needed.length) continue

			const needsLink = needed.some((r) => r.source === 'document_text')
			const links = needsLink && text ? linkReferences(text, hints) : []

			for (const ev of needed) {
				if (ev.source === 'document_text') {
					const dated = { date: ev.date, kind: ev.kind, quote: ev.quote ?? '', start: ev.start, end: ev.start }
					const near = entitiesNearEvent(dated, hints, links)
					const unresolved = links
						.filter(
							(l) =>
								!l.attachedTo &&
								l.end >= ev.start - 180 &&
								l.start <= ev.start + 180,
						)
						.map((l) => l.reference)
					const entityRows = near.map((p) => ({
						normalizedName: p.normalizedName,
						name: p.name,
						role: p.role,
						mentionCount: p.mentionCount ?? 0,
					}))
					events.push({
						id: `${doc.id}:${ev.date}:${ev.start}`,
						documentId: doc.id,
						filename: doc.filename,
						documentType: doc.documentType,
						date: ev.date,
						dateSource: ev.source,
						kind: ev.kind,
						quote: ev.quote,
						summary: summarizeEvent(ev.quote, ev.kind, entityRows, doc.documentType),
						entities: entityRows,
						unresolvedRefs: [...new Set(unresolved)],
					})
					continue
				}

				const entityRows = parts.map((p) => ({
					normalizedName: p.normalizedName,
					name: p.name,
					role: p.role,
					mentionCount: p.mentionCount ?? 0,
				}))
				events.push({
					id: `${doc.id}:${ev.date}:meta`,
					documentId: doc.id,
					filename: doc.filename,
					documentType: doc.documentType,
					date: ev.date,
					dateSource: ev.source,
					kind: 'document',
					quote: null,
					summary: summarizeEvent(null, 'document', entityRows, doc.documentType),
					entities: entityRows,
					unresolvedRefs: [],
				})
			}
		}

		events.sort((a, b) => a.date.localeCompare(b.date) || a.documentId - b.documentId)
		return { events, totalEvents, totalDates: allDates.length }
	}

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
					if (overlap >= 2 || (overlap === 1 && cTokens.length === 1 && cTokens[0].length > 4)) {
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
				const meta = CasesService.extractDocumentDate(d.structuredData)
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
						const targetId = CasesService.matchDocumentReference(ref, docs, doc.id)
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

	static async getCaseNetwork(caseId: number, entityCap = 24): Promise<CaseNetwork> {
		const docs = await documentRepository.findByCaseId(caseId)
		const graph = await CasesService.getDocumentGraph(caseId)

		const byName = new Map<
			string,
			{
				name: string
				normalizedName: string
				role: string
				mentionCount: number
				relevanceScore: number
				documentIds: Set<number>
				roleCounts: Map<string, number>
			}
		>()

		for (const doc of docs) {
			const parts = await participantRepository.findByDocumentId(doc.id)
			for (const p of parts) {
				const key = p.normalizedName
				const existing = byName.get(key)
				const role = p.role || 'other'
				if (!existing) {
					byName.set(key, {
						name: p.name,
						normalizedName: p.normalizedName,
						role,
						mentionCount: p.mentionCount ?? 0,
						relevanceScore: p.relevanceScore ?? 0,
						documentIds: new Set([doc.id]),
						roleCounts: new Map([[role, 1]]),
					})
				} else {
					existing.mentionCount += p.mentionCount ?? 0
					existing.documentIds.add(doc.id)
					existing.roleCounts.set(role, (existing.roleCounts.get(role) ?? 0) + 1)
					const bestRole = [...existing.roleCounts.entries()].sort((a, b) => b[1] - a[1])[0]
					if (bestRole) existing.role = bestRole[0]
					if ((p.relevanceScore ?? 0) > existing.relevanceScore) {
						existing.relevanceScore = p.relevanceScore ?? 0
						existing.name = p.name
					}
				}
			}
		}

		const nodes: CaseNetworkNode[] = []
		const edges: CaseNetworkEdge[] = []
		const caseNodeId = `case:${caseId}`
		const caseNumber = docs[0]?.caseNumber ?? `CASE-${caseId}`

		nodes.push({
			id: caseNodeId,
			kind: 'case',
			label: caseNumber,
			sublabel: docs[0]?.documentType,
			weight: 4,
			caseId,
			documentCount: docs.length,
		})

		for (const doc of docs) {
			const id = `doc:${doc.id}`
			nodes.push({
				id,
				kind: 'document',
				label: doc.filename,
				sublabel: doc.documentType?.replace(/_/g, ' '),
				documentType: doc.documentType,
				documentId: doc.id,
				weight: 2,
			})
			edges.push({ source: caseNodeId, target: id, kind: 'has_document' })
		}

		const entityList = [...byName.values()].sort((a, b) => {
			if (b.mentionCount !== a.mentionCount) return b.mentionCount - a.mentionCount
			return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)
		})

		const roleCounts = new Map<string, number>()
		for (const e of entityList) {
			roleCounts.set(e.role, (roleCounts.get(e.role) ?? 0) + 1)
		}

		for (const [role, count] of [...roleCounts.entries()].sort((a, b) => b[1] - a[1])) {
			const id = `role:${role}`
			nodes.push({
				id,
				kind: 'role',
				label: role.replace(/_/g, ' '),
				role,
				weight: Math.min(3, 1 + count / 2),
				mentionCount: count,
			})
			edges.push({ source: caseNodeId, target: id, kind: 'has_role' })
		}

		const kept = entityList.slice(0, entityCap)
		for (const e of kept) {
			const id = `entity:${e.normalizedName}`
			nodes.push({
				id,
				kind: 'entity',
				label: e.name,
				sublabel: e.role.replace(/_/g, ' '),
				role: e.role,
				normalizedName: e.normalizedName,
				mentionCount: e.mentionCount,
				documentCount: e.documentIds.size,
				weight: 1 + Math.min(2, e.mentionCount / 8),
			})
			edges.push({ source: `role:${e.role}`, target: id, kind: 'has_entity' })
			for (const docId of e.documentIds) {
				edges.push({ source: id, target: `doc:${docId}`, kind: 'mentioned_in' })
			}
		}

		for (const e of graph.edges) {
			edges.push({
				source: `doc:${e.sourceDocumentId}`,
				target: `doc:${e.targetDocumentId}`,
				kind: 'doc_ref',
				label: e.label,
			})
		}

		return {
			focusId: caseNodeId,
			focusType: 'case',
			caseId,
			caseNumber,
			title: '',
			caseType: '',
			status: '',
			nodes,
			edges,
			totals: {
				entities: entityList.length,
				roles: roleCounts.size,
				documents: docs.length,
				cases: 1,
				links: edges.length,
				hiddenEntities: Math.max(0, entityList.length - kept.length),
			},
		}
	}

	static parseFocus(raw: string): NetworkFocus | null {
		const trimmed = raw.trim()
		const split = trimmed.indexOf(':')
		if (split <= 0) return null
		const type = trimmed.slice(0, split)
		const id = trimmed.slice(split + 1)
		if (!id) return null
		if (type === 'case' || type === 'entity' || type === 'role') return { type, id }
		if (type === 'document' || type === 'doc') return { type: 'document', id }
		return null
	}

	static focusNodeId(focus: NetworkFocus): string {
		if (focus.type === 'document') return `doc:${focus.id}`
		return `${focus.type}:${focus.id}`
	}

	static async getFocusNetwork(focus: NetworkFocus, entityCap = 24): Promise<CaseNetwork | null> {
		if (focus.type === 'case') {
			const caseId = Number(focus.id)
			if (Number.isNaN(caseId)) return null
			return CasesService.getCaseNetwork(caseId, entityCap)
		}
		if (focus.type === 'entity') {
			return CasesService.getEntityNetwork(focus.id, entityCap)
		}
		if (focus.type === 'document') {
			const documentId = Number(focus.id)
			if (Number.isNaN(documentId)) return null
			return CasesService.getDocumentNetwork(documentId, entityCap)
		}
		return CasesService.getRoleNetwork(focus.id, focus.caseId, entityCap)
	}

	private static pushNode(nodes: CaseNetworkNode[], node: CaseNetworkNode) {
		if (!nodes.some((n) => n.id === node.id)) nodes.push(node)
	}

	private static pushEdge(edges: CaseNetworkEdge[], edge: CaseNetworkEdge) {
		if (
			!edges.some(
				(e) => e.source === edge.source && e.target === edge.target && e.kind === edge.kind,
			)
		) {
			edges.push(edge)
		}
	}

	static async getEntityNetwork(normalizedName: string, entityCap = 16): Promise<CaseNetwork | null> {
		const found = await participantRepository.search({
			name: normalizedName,
			limit: 100,
		})
		const rows = (found.data ?? []).filter(
			(p) => p.normalizedName === normalizedName || p.normalizedName.includes(normalizedName),
		)
		const exact = rows.filter((p) => p.normalizedName === normalizedName)
		const appearances = exact.length > 0 ? exact : rows
		if (appearances.length === 0) return null

		const displayName = appearances[0]?.name ?? normalizedName
		const primaryRole = appearances
			.map((p) => p.role || 'other')
			.sort(
				(a, b) =>
					appearances.filter((p) => (p.role || 'other') === b).length -
					appearances.filter((p) => (p.role || 'other') === a).length,
			)[0] ?? 'other'

		const nodes: CaseNetworkNode[] = []
		const edges: CaseNetworkEdge[] = []
		const entityId = `entity:${normalizedName}`
		const mentionCount = appearances.reduce((s, p) => s + (p.mentionCount ?? 0), 0)
		const docIds = [...new Set(appearances.map((p) => p.documentId))]

		CasesService.pushNode(nodes, {
			id: entityId,
			kind: 'entity',
			label: displayName,
			sublabel: primaryRole.replace(/_/g, ' '),
			role: primaryRole,
			normalizedName,
			mentionCount,
			documentCount: docIds.length,
			weight: 4,
		})

		const cases = new Map<number, { caseNumber: string }>()
		for (const p of appearances) {
			const docId = `doc:${p.documentId}`
			CasesService.pushNode(nodes, {
				id: docId,
				kind: 'document',
				label: `DOC-${p.documentId}`,
				sublabel: (p.documentType ?? '').replace(/_/g, ' '),
				documentType: p.documentType,
				documentId: p.documentId,
				caseId: p.caseId ?? undefined,
				weight: 2,
			})
			CasesService.pushEdge(edges, { source: entityId, target: docId, kind: 'mentioned_in' })

			const role = p.role || 'other'
			const roleId = `role:${role}`
			CasesService.pushNode(nodes, {
				id: roleId,
				kind: 'role',
				label: role.replace(/_/g, ' '),
				role,
				weight: 2,
			})
			CasesService.pushEdge(edges, { source: entityId, target: roleId, kind: 'has_role' })

			if (p.caseId != null) {
				cases.set(p.caseId, { caseNumber: p.caseNumber ?? `CASE-${p.caseId}` })
				const caseId = `case:${p.caseId}`
				CasesService.pushNode(nodes, {
					id: caseId,
					kind: 'case',
					label: p.caseNumber ?? `CASE-${p.caseId}`,
					weight: 3,
					caseId: p.caseId,
				})
				CasesService.pushEdge(edges, { source: docId, target: caseId, kind: 'in_case' })
				CasesService.pushEdge(edges, { source: caseId, target: entityId, kind: 'has_entity' })
			}
		}

		for (const documentId of docIds) {
			const doc = await documentRepository.findById(documentId)
			const node = nodes.find((n) => n.id === `doc:${documentId}`)
			if (node && doc) {
				node.label = doc.filename
				node.documentType = doc.documentType
				node.sublabel = doc.documentType?.replace(/_/g, ' ')
				if (doc.caseId != null) node.caseId = doc.caseId
			}
			const parts = await participantRepository.findByDocumentId(documentId)
			for (const other of parts) {
				if (other.normalizedName === normalizedName) continue
				if (nodes.filter((n) => n.kind === 'entity').length >= entityCap + 1) break
				const otherId = `entity:${other.normalizedName}`
				CasesService.pushNode(nodes, {
					id: otherId,
					kind: 'entity',
					label: other.name,
					sublabel: (other.role || 'other').replace(/_/g, ' '),
					role: other.role || 'other',
					normalizedName: other.normalizedName,
					mentionCount: other.mentionCount ?? 0,
					weight: 1,
				})
				CasesService.pushEdge(edges, {
					source: entityId,
					target: otherId,
					kind: 'co_occurs',
					label: doc?.filename,
				})
				CasesService.pushEdge(edges, {
					source: otherId,
					target: `doc:${documentId}`,
					kind: 'mentioned_in',
				})
			}
		}

		const firstCase = [...cases.entries()][0]
		return {
			focusId: entityId,
			focusType: 'entity',
			caseId: firstCase?.[0] ?? 0,
			caseNumber: firstCase?.[1].caseNumber ?? '',
			title: displayName,
			caseType: '',
			status: '',
			nodes,
			edges,
			totals: {
				entities: nodes.filter((n) => n.kind === 'entity').length,
				roles: nodes.filter((n) => n.kind === 'role').length,
				documents: nodes.filter((n) => n.kind === 'document').length,
				cases: cases.size,
				links: edges.length,
				hiddenEntities: 0,
			},
		}
	}

	static async getDocumentNetwork(documentId: number, entityCap = 24): Promise<CaseNetwork | null> {
		const doc = await documentRepository.findById(documentId)
		if (!doc) return null

		const nodes: CaseNetworkNode[] = []
		const edges: CaseNetworkEdge[] = []
		const docNodeId = `doc:${doc.id}`

		CasesService.pushNode(nodes, {
			id: docNodeId,
			kind: 'document',
			label: doc.filename,
			sublabel: doc.documentType?.replace(/_/g, ' '),
			documentType: doc.documentType,
			documentId: doc.id,
			caseId: doc.caseId ?? undefined,
			weight: 4,
		})

		if (doc.caseId != null) {
			const caseId = `case:${doc.caseId}`
			CasesService.pushNode(nodes, {
				id: caseId,
				kind: 'case',
				label: doc.caseNumber ?? `CASE-${doc.caseId}`,
				weight: 3,
				caseId: doc.caseId,
			})
			CasesService.pushEdge(edges, { source: caseId, target: docNodeId, kind: 'has_document' })

			const siblings = await documentRepository.findByCaseId(doc.caseId)
			for (const sib of siblings) {
				if (sib.id === doc.id) continue
				const sibId = `doc:${sib.id}`
				CasesService.pushNode(nodes, {
					id: sibId,
					kind: 'document',
					label: sib.filename,
					sublabel: sib.documentType?.replace(/_/g, ' '),
					documentType: sib.documentType,
					documentId: sib.id,
					caseId: doc.caseId,
					weight: 2,
				})
				CasesService.pushEdge(edges, { source: caseId, target: sibId, kind: 'has_document' })
			}

			const graph = await CasesService.getDocumentGraph(doc.caseId)
			for (const e of graph.edges) {
				if (e.sourceDocumentId !== doc.id && e.targetDocumentId !== doc.id) continue
				CasesService.pushEdge(edges, {
					source: `doc:${e.sourceDocumentId}`,
					target: `doc:${e.targetDocumentId}`,
					kind: 'doc_ref',
					label: e.label,
				})
			}
		}

		const parts = await participantRepository.findByDocumentId(doc.id)
		const roleCounts = new Map<string, number>()
		for (const p of parts) {
			const role = p.role || 'other'
			roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1)
		}
		for (const [role, count] of roleCounts) {
			const roleId = `role:${role}`
			CasesService.pushNode(nodes, {
				id: roleId,
				kind: 'role',
				label: role.replace(/_/g, ' '),
				role,
				mentionCount: count,
				weight: 2,
			})
			CasesService.pushEdge(edges, { source: docNodeId, target: roleId, kind: 'has_role' })
		}

		const kept = [...parts]
			.sort((a, b) => (b.mentionCount ?? 0) - (a.mentionCount ?? 0))
			.slice(0, entityCap)
		for (const p of kept) {
			const entityId = `entity:${p.normalizedName}`
			CasesService.pushNode(nodes, {
				id: entityId,
				kind: 'entity',
				label: p.name,
				sublabel: (p.role || 'other').replace(/_/g, ' '),
				role: p.role || 'other',
				normalizedName: p.normalizedName,
				mentionCount: p.mentionCount ?? 0,
				weight: 1 + Math.min(2, (p.mentionCount ?? 0) / 8),
			})
			CasesService.pushEdge(edges, { source: entityId, target: docNodeId, kind: 'mentioned_in' })
			CasesService.pushEdge(edges, {
				source: `role:${p.role || 'other'}`,
				target: entityId,
				kind: 'has_entity',
			})
		}

		return {
			focusId: docNodeId,
			focusType: 'document',
			caseId: doc.caseId ?? 0,
			caseNumber: doc.caseNumber ?? '',
			title: doc.filename,
			caseType: doc.documentType ?? '',
			status: '',
			nodes,
			edges,
			totals: {
				entities: parts.length,
				roles: roleCounts.size,
				documents: nodes.filter((n) => n.kind === 'document').length,
				cases: doc.caseId != null ? 1 : 0,
				links: edges.length,
				hiddenEntities: Math.max(0, parts.length - kept.length),
			},
		}
	}

	static async getRoleNetwork(
		role: string,
		caseId?: number,
		entityCap = 24,
	): Promise<CaseNetwork | null> {
		const nodes: CaseNetworkNode[] = []
		const edges: CaseNetworkEdge[] = []
		const roleId = `role:${role}`
		CasesService.pushNode(nodes, {
			id: roleId,
			kind: 'role',
			label: role.replace(/_/g, ' '),
			role,
			weight: 4,
		})

		type Row = {
			name: string
			normalizedName: string
			role: string
			mentionCount: number
			documentId: number
			caseId: number | null
			caseNumber: string | null
			documentType?: string
			filename?: string
		}
		const rows: Row[] = []

		if (caseId != null) {
			const docs = await documentRepository.findByCaseId(caseId)
			for (const doc of docs) {
				const parts = await participantRepository.findByDocumentId(doc.id)
				for (const p of parts) {
					if ((p.role || 'other') !== role) continue
					rows.push({
						name: p.name,
						normalizedName: p.normalizedName,
						role: p.role || 'other',
						mentionCount: p.mentionCount ?? 0,
						documentId: doc.id,
						caseId: doc.caseId ?? caseId,
						caseNumber: doc.caseNumber ?? null,
						documentType: doc.documentType,
						filename: doc.filename,
					})
				}
			}
		} else {
			const found = await participantRepository.search({ role, limit: 80 })
			for (const p of found.data ?? []) {
				if ((p.role || 'other') !== role) continue
				rows.push({
					name: p.name,
					normalizedName: p.normalizedName,
					role: p.role || 'other',
					mentionCount: p.mentionCount ?? 0,
					documentId: p.documentId,
					caseId: p.caseId ?? null,
					caseNumber: p.caseNumber ?? null,
					documentType: p.documentType,
				})
			}
		}

		if (rows.length === 0) {
			return {
				focusId: roleId,
				focusType: 'role',
				caseId: caseId ?? 0,
				caseNumber: '',
				title: role.replace(/_/g, ' '),
				caseType: '',
				status: '',
				nodes,
				edges,
				totals: {
					entities: 0,
					roles: 1,
					documents: 0,
					cases: 0,
					links: 0,
					hiddenEntities: 0,
				},
			}
		}

		const byEntity = new Map<string, Row[]>()
		for (const row of rows) {
			const list = byEntity.get(row.normalizedName) ?? []
			list.push(row)
			byEntity.set(row.normalizedName, list)
		}

		const ranked = [...byEntity.entries()].sort((a, b) => {
			const ma = a[1].reduce((s, r) => s + r.mentionCount, 0)
			const mb = b[1].reduce((s, r) => s + r.mentionCount, 0)
			return mb - ma
		})
		const kept = ranked.slice(0, entityCap)

		for (const [normalizedName, list] of kept) {
			const entityId = `entity:${normalizedName}`
			const mentions = list.reduce((s, r) => s + r.mentionCount, 0)
			CasesService.pushNode(nodes, {
				id: entityId,
				kind: 'entity',
				label: list[0].name,
				sublabel: role.replace(/_/g, ' '),
				role,
				normalizedName,
				mentionCount: mentions,
				documentCount: new Set(list.map((r) => r.documentId)).size,
				weight: 1 + Math.min(2, mentions / 8),
			})
			CasesService.pushEdge(edges, { source: roleId, target: entityId, kind: 'has_entity' })

			for (const row of list) {
				const docId = `doc:${row.documentId}`
				CasesService.pushNode(nodes, {
					id: docId,
					kind: 'document',
					label: row.filename ?? `DOC-${row.documentId}`,
					sublabel: (row.documentType ?? '').replace(/_/g, ' '),
					documentType: row.documentType,
					documentId: row.documentId,
					caseId: row.caseId ?? undefined,
					weight: 2,
				})
				CasesService.pushEdge(edges, { source: entityId, target: docId, kind: 'mentioned_in' })

				if (row.caseId != null) {
					const cId = `case:${row.caseId}`
					CasesService.pushNode(nodes, {
						id: cId,
						kind: 'case',
						label: row.caseNumber ?? `CASE-${row.caseId}`,
						weight: 3,
						caseId: row.caseId,
					})
					CasesService.pushEdge(edges, { source: docId, target: cId, kind: 'in_case' })
					CasesService.pushEdge(edges, { source: cId, target: roleId, kind: 'has_role' })
				}
			}
		}

		return {
			focusId: roleId,
			focusType: 'role',
			caseId: caseId ?? ranked[0]?.[1][0]?.caseId ?? 0,
			caseNumber: '',
			title: role.replace(/_/g, ' '),
			caseType: '',
			status: '',
			nodes,
			edges,
			totals: {
				entities: byEntity.size,
				roles: 1,
				documents: nodes.filter((n) => n.kind === 'document').length,
				cases: nodes.filter((n) => n.kind === 'case').length,
				links: edges.length,
				hiddenEntities: Math.max(0, byEntity.size - kept.length),
			},
		}
	}

	static async getRoleVarianceFlags(caseId: number): Promise<RoleVarianceFlag[]> {
		const docs = await documentRepository.findByCaseId(caseId)
		const byName = new Map<
			string,
			{
				displayName: string
				roles: Map<string, Set<number>>
			}
		>()

		for (const doc of docs) {
			const parts = await participantRepository.findByDocumentId(doc.id)
			for (const p of parts) {
				const entry = byName.get(p.normalizedName) ?? {
					displayName: p.name,
					roles: new Map(),
				}
				const role = p.role || 'other'
				const docsForRole = entry.roles.get(role) ?? new Set()
				docsForRole.add(doc.id)
				entry.roles.set(role, docsForRole)
				byName.set(p.normalizedName, entry)
			}
		}

		const flags: RoleVarianceFlag[] = []
		for (const [normalizedName, entry] of byName) {
			if (entry.roles.size < 2) continue

			const roles = [...entry.roles.entries()]
				.map(([role, documentIds]) => ({
					role,
					documentIds: [...documentIds],
					count: documentIds.size,
				}))
				.sort((a, b) => b.count - a.count)

			const primary = roles[0]
			const outliers = roles.slice(1)
			flags.push({
				normalizedName,
				displayName: entry.displayName,
				roles,
				primaryRole: primary.role,
				flag: `Role varies: primary "${primary.role}" (${primary.count} docs); also ${outliers
					.map((o) => `"${o.role}" (${o.count})`)
					.join(', ')}`,
			})
		}

		flags.sort((a, b) => b.roles.length - a.roles.length || a.normalizedName.localeCompare(b.normalizedName))
		return flags
	}

	static async getEntityTrajectories(caseId: number): Promise<EntityTrajectory[]> {
		const docs = await documentRepository.findByCaseId(caseId)
		const chronology = (await CasesService.getDocumentChronology(caseId)).events
		const dateByDoc = new Map<number, string>()
		for (const e of chronology) {
			const prev = dateByDoc.get(e.documentId)
			if (!prev || e.date < prev) dateByDoc.set(e.documentId, e.date)
		}

		// Sort docs by extracted date then id
		const orderedDocs = [...docs].sort((a, b) => {
			const da = dateByDoc.get(a.id) ?? ''
			const db = dateByDoc.get(b.id) ?? ''
			if (da && db && da !== db) return da.localeCompare(db)
			if (da && !db) return -1
			if (!da && db) return 1
			return a.id - b.id
		})

		const byName = new Map<string, EntityTrajectory>()

		for (const doc of orderedDocs) {
			const parts = await participantRepository.findByDocumentId(doc.id)
			for (const p of parts) {
				const traj = byName.get(p.normalizedName) ?? {
					normalizedName: p.normalizedName,
					displayName: p.name,
					points: [],
				}
				traj.points.push({
					documentId: doc.id,
					filename: doc.filename,
					documentType: doc.documentType,
					date: dateByDoc.get(doc.id) ?? null,
					mentionCount: p.mentionCount ?? 0,
					role: p.role,
				})
				byName.set(p.normalizedName, traj)
			}
		}

		return [...byName.values()]
			.filter((t) => t.points.length >= 1)
			.sort((a, b) => {
				const sumA = a.points.reduce((s, p) => s + p.mentionCount, 0)
				const sumB = b.points.reduce((s, p) => s + p.mentionCount, 0)
				return sumB - sumA
			})
	}

	static classifyTrajectory(
		points: { mentionCount: number }[],
	): { trend: 'surge' | 'drop' | 'stable' | 'single'; label: string; delta: number } {
		if (points.length < 2) return { trend: 'single', label: 'FIRST_SEEN', delta: 0 }
		const first = points[0].mentionCount
		const last = points[points.length - 1].mentionCount
		const delta = last - first
		const base = Math.max(first, 1)
		const pct = Math.round((delta / base) * 100)
		if (delta >= Math.max(2, Math.ceil(base * 0.25))) {
			return { trend: 'surge', label: pct > 0 ? `SURGE +${pct}%` : 'SURGE', delta }
		}
		if (delta <= -Math.max(2, Math.ceil(base * 0.25))) {
			return { trend: 'drop', label: `DROP ${pct}%`, delta }
		}
		return { trend: 'stable', label: 'STABLE', delta }
	}

	static async getIntelligenceGraph(caseId: number): Promise<CaseNetwork> {
		const docs = await documentRepository.findByCaseId(caseId)
		const flags = await CasesService.getRoleVarianceFlags(caseId)
		const trajectories = await CasesService.getEntityTrajectories(caseId)
		const links = await CasesService.getReferenceLinks(caseId)

		const nodes: CaseNetworkNode[] = []
		const edges: CaseNetworkEdge[] = []
		const caseNodeId = `case:${caseId}`
		const caseNumber = docs[0]?.caseNumber ?? `CASE-${caseId}`

		CasesService.pushNode(nodes, {
			id: caseNodeId,
			kind: 'case',
			label: caseNumber,
			weight: 4,
			caseId,
			documentCount: docs.length,
		})

		const docById = new Map(docs.map((d) => [d.id, d]))

		const addDoc = (documentId: number) => {
			const doc = docById.get(documentId)
			if (!doc) return
			const id = `doc:${doc.id}`
			CasesService.pushNode(nodes, {
				id,
				kind: 'document',
				label: doc.filename,
				sublabel: doc.documentType?.replace(/_/g, ' '),
				documentType: doc.documentType,
				documentId: doc.id,
				caseId,
				weight: 1.6,
			})
			CasesService.pushEdge(edges, { source: caseNodeId, target: id, kind: 'has_document' })
		}

		const addEntity = (normalizedName: string, displayName: string, role?: string) => {
			const id = `entity:${normalizedName}`
			CasesService.pushNode(nodes, {
				id,
				kind: 'entity',
				label: displayName,
				sublabel: role?.replace(/_/g, ' '),
				role,
				normalizedName,
				weight: 2.2,
			})
			return id
		}

		for (const flag of flags.slice(0, 12)) {
			const entityId = addEntity(flag.normalizedName, flag.displayName, flag.primaryRole)
			const signalId = `signal:variance:${flag.normalizedName}`
			CasesService.pushNode(nodes, {
				id: signalId,
				kind: 'signal',
				label: 'ROLE VARIES',
				sublabel: flag.primaryRole.replace(/_/g, ' '),
				signal: 'role_variance',
				detail: flag.flag,
				normalizedName: flag.normalizedName,
				role: flag.primaryRole,
				weight: 2.4,
			})
			CasesService.pushEdge(edges, { source: caseNodeId, target: signalId, kind: 'has_signal' })
			CasesService.pushEdge(edges, { source: signalId, target: entityId, kind: 'about' })
			for (const r of flag.roles) {
				for (const documentId of r.documentIds.slice(0, 3)) addDoc(documentId)
			}
		}

		let surgeCount = 0
		let dropCount = 0
		for (const traj of trajectories) {
			const { trend, label } = CasesService.classifyTrajectory(traj.points)
			if (trend !== 'surge' && trend !== 'drop') continue
			if (trend === 'surge' && surgeCount >= 8) continue
			if (trend === 'drop' && dropCount >= 8) continue
			if (trend === 'surge') surgeCount += 1
			else dropCount += 1

			const entityId = addEntity(
				traj.normalizedName,
				traj.displayName,
				traj.points[traj.points.length - 1]?.role,
			)
			const signalId = `signal:${trend}:${traj.normalizedName}`
			CasesService.pushNode(nodes, {
				id: signalId,
				kind: 'signal',
				label,
				sublabel: traj.displayName,
				signal: trend,
				detail: `${traj.displayName} mention ${trend} across ${traj.points.length} documents.`,
				normalizedName: traj.normalizedName,
				mentionCount: traj.points.reduce((s, p) => s + p.mentionCount, 0),
				weight: 2.6,
			})
			CasesService.pushEdge(edges, { source: caseNodeId, target: signalId, kind: 'has_signal' })
			CasesService.pushEdge(edges, { source: signalId, target: entityId, kind: 'about' })
			const last = traj.points[traj.points.length - 1]
			const first = traj.points[0]
			if (first) addDoc(first.documentId)
			if (last) addDoc(last.documentId)
		}

		let unresolvedCount = 0
		for (const link of links) {
			if (link.attachedTo) continue
			if (unresolvedCount >= 10) break
			unresolvedCount += 1
			const signalId = `signal:unresolved:${link.documentId}:${link.start}`
			CasesService.pushNode(nodes, {
				id: signalId,
				kind: 'signal',
				label: link.reference.slice(0, 28),
				sublabel: 'UNRESOLVED',
				signal: 'unresolved',
				detail: link.evidence || `Unattached reference “${link.reference}” in ${link.filename}.`,
				documentId: link.documentId,
				weight: 1.8,
			})
			CasesService.pushEdge(edges, { source: caseNodeId, target: signalId, kind: 'has_signal' })
			addDoc(link.documentId)
			CasesService.pushEdge(edges, {
				source: signalId,
				target: `doc:${link.documentId}`,
				kind: 'about',
				label: link.reference,
			})
		}

		return {
			focusId: caseNodeId,
			focusType: 'case',
			caseId,
			caseNumber,
			title: '',
			caseType: '',
			status: '',
			nodes,
			edges,
			totals: {
				entities: nodes.filter((n) => n.kind === 'entity').length,
				roles: nodes.filter((n) => n.kind === 'signal').length,
				documents: nodes.filter((n) => n.kind === 'document').length,
				cases: 1,
				links: edges.length,
				hiddenEntities: 0,
			},
		}
	}

	static mentionSourceText(resolvedText?: string | null, fullContent?: unknown): string {
		if (resolvedText) return resolvedText
		const fc = fullContent as { content?: string } | null
		return fc?.content || ''
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
		} as any)
	}

	static async getMentionContexts(participantId: number, padding = 120) {
		const participant = await participantRepository.findById(participantId)
		if (!participant?.clusterId) return []

		const coref = await coreferenceRepository.findByDocumentId(participant.documentId)
		if (!coref) return []

		const cluster = coref.clusters.find(c => c.clusterIndex === participant.clusterId)
		if (!cluster) return []

		const doc = await documentRepository.findById(participant.documentId)
		const text = CasesService.mentionSourceText(coref.resolvedText, doc?.fullContent)

		if (!text) return cluster.mentions.map(m => ({ text: m.text, start: m.startPos, end: m.endPos, context: m.text }))

		return cluster.mentions.map(m => {
			const excerpt = CasesService.excerptMention(text, m.startPos, m.endPos, m.text, padding)
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
			const text = CasesService.mentionSourceText(r.resolvedText, r.fullContent)
			const start = r.startPos
			const end = r.endPos

			if (!text) {
				return { text: r.mentionText, start, end, context: r.mentionText, documentId: r.documentId, filename: r.filename }
			}

			const excerpt = CasesService.excerptMention(text, start, end, r.mentionText, padding)
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
