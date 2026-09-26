import { documentRepository, participantRepository } from '@workspace/shared'
import {
	documentBodyText,
	entitiesNearEvent,
	extractDatedEvents,
	linkReferences,
	summarizeEvent,
	type ParticipantHint,
} from './linker'
import type { ChronologyEvent, ChronologyPage } from './types'

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
export abstract class ChronologyService {
	static extractDocumentDate(
		structuredData: object | string | null | undefined,
		fallbackCreatedAt?: Date | string | null,
	): { date: string; source: string } | null {
		const fromStructured = ChronologyService.findDateInValue(structuredData, 'structuredData')
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

	static findDateInValue(
		value: object | string | number | boolean | null | undefined,
		path: string,
		depth = 0,
	): { date: string; source: string } | null {
		if (value == null || depth > 6) return null

		if (typeof value === 'string') {
			const parsed = ChronologyService.parseDateString(value)
			if (parsed) return { date: parsed, source: path }
			return null
		}

		if (typeof value === 'object' && !Array.isArray(value)) {
			const obj = value as { [key: string]: object | string | number | boolean | null | undefined }

			// Azure DI style: { fieldName: { valueDate: "..." } } or { valueString: "..." }
			for (const key of DATE_FIELD_KEYS) {
				if (!(key in obj)) continue
				const field = obj[key]
				if (typeof field === 'string') {
					const parsed = ChronologyService.parseDateString(field)
					if (parsed) return { date: parsed, source: `${path}.${key}` }
				}
				if (field && typeof field === 'object') {
					const f = field as Record<string, unknown>
					const candidates = [f.valueDate, f.content, f.valueString, f.value]
					for (const c of candidates) {
						if (typeof c === 'string') {
							const parsed = ChronologyService.parseDateString(c)
							if (parsed) return { date: parsed, source: `${path}.${key}` }
						}
					}
				}
			}

			if (obj.fields && typeof obj.fields === 'object') {
				const nested = ChronologyService.findDateInValue(obj.fields, `${path}.fields`, depth + 1)
				if (nested) return nested
			}

			for (const [k, v] of Object.entries(obj)) {
				if (DATE_FIELD_KEYS.includes(k)) continue
				const nested = ChronologyService.findDateInValue(v, `${path}.${k}`, depth + 1)
				if (nested) return nested
			}
		}

		if (Array.isArray(value)) {
			for (let i = 0; i < value.length; i++) {
				const nested = ChronologyService.findDateInValue(value[i], `${path}[${i}]`, depth + 1)
				if (nested) return nested
			}
		}

		return null
	}

	static parseDateString(raw: string): string | null {
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
						const structured = doc.structuredData
						const extracted = ChronologyService.extractDocumentDate(
							typeof structured === 'object' && structured !== null
								? structured
								: typeof structured === 'string'
									? structured
									: null,
						)
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

}
