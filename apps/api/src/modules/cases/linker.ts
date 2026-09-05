export type EventKind =
	| 'incident'
	| 'arrest'
	| 'filing'
	| 'hearing'
	| 'judgment'
	| 'document'
	| 'other'

export interface ParticipantHint {
	name: string
	normalizedName: string
	role: string
	mentions?: string[] | null
	mentionCount?: number | null
}

export interface LinkedReference {
	reference: string
	attachedTo: string | null
	attachedName: string | null
	evidence: string
	confidence: number
	start: number
	end: number
}

export interface DatedEvent {
	date: string
	kind: EventKind
	quote: string
	start: number
	end: number
}

const MONTHS =
	'January|February|March|April|May|June|July|August|September|October|November|December'

const DATE_PATTERNS: RegExp[] = [
	/\b(20\d{2}|19\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/g,
	/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2}|19\d{2})\b/g,
	new RegExp(
		`\\b((?:${MONTHS})\\s+\\d{1,2},?\\s+(?:20\\d{2}|19\\d{2}))\\b`,
		'gi',
	),
	new RegExp(
		`\\b(\\d{1,2}(?:st|nd|rd|th)?\\s+(?:day of\\s+)?(?:${MONTHS}),?\\s+(?:20\\d{2}|19\\d{2}))\\b`,
		'gi',
	),
]

const KIND_RULES: { kind: EventKind; re: RegExp }[] = [
	{ kind: 'judgment', re: /\b(judgment|judgement|convicted|sentenced|held that|delivered)\b/i },
	{ kind: 'hearing', re: /\b(heard|hearing|mention|plea|appeared before)\b/i },
	{ kind: 'arrest', re: /\b(arrested|apprehended|taken into custody)\b/i },
	{ kind: 'filing', re: /\b(filed|filing|lodged|instituted|plaint)\b/i },
	{ kind: 'incident', re: /\b(occurred|took place|incident|alleged|on or about|complain)\b/i },
]

const WINDOW = 180
const KIND_WINDOW = 48
const LINK_WINDOW_BEFORE = 36
const LINK_WINDOW_AFTER = 72

/** Document-structure nouns — not people. Closed on purpose; everything else can be a candidate. */
const STRUCTURE_HEADS = new Set([
	'court', 'case', 'law', 'act', 'section', 'article', 'evidence', 'record',
	'file', 'document', 'application', 'matter', 'suit', 'appeal', 'proceedings',
	'hearing', 'trial', 'judgment', 'judgement', 'order', 'ruling', 'charge',
	'offence', 'offense', 'crime', 'sentence', 'fact', 'facts', 'issue', 'issues',
	'time', 'date', 'day', 'year', 'place', 'scene', 'area', 'station', 'weapon',
	'exhibit', 'item', 'amount', 'sum', 'way', 'basis', 'purpose', 'interest',
	'right', 'duty', 'state', 'republic', 'prosecution', 'defence', 'defense',
	'attention', 'view', 'opinion', 'submission', 'argument',
])

/** Role vocabulary (types), not surface phrases. Used only when a role is unique in the document. */
const ROLE_HEADS: Record<string, string[]> = {
	defendant: ['defendant', 'accused', 'respondent'],
	plaintiff: ['plaintiff', 'complainant', 'petitioner', 'appellant'],
	witness: ['witness', 'informant', 'deponent'],
	police: ['officer', 'inspector', 'constable', 'police'],
	police_officer: ['officer', 'inspector', 'constable', 'police'],
	judge: ['judge', 'justice', 'magistrate', 'lordship', 'ladyship'],
	prosecutor: ['prosecutor', 'prosecution'],
}

// Determiner + optional ordinal + first word (any case) + only lowercase
// continuations so "the informant Jane" does not swallow the proper name.
const DEFINITE_NP_RE =
	/\b((?:the|a|an)\s+(?:(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|said|learned|above-named|aforementioned)\s+)?[A-Za-z][A-Za-z'-]*(?:\s+[a-z][A-Za-z'-]*){0,3})\b/gi

const NUMBERED_PARTY_RE = /\b(?:PW|DW|IO|PC|CPL)\s*\.?\s*\d+\b/gi

const POSSESSIVE_NP_RE = /\b((?:his|her|their)\s+[A-Za-z][A-Za-z'-]{2,})\b/gi

export interface ReferenceCandidate {
	reference: string
	start: number
	end: number
}

export function parseDateToken(raw: string): string | null {
	const s = raw.trim()
	if (!s) return null

	const iso = s.match(/\b(20\d{2}|19\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/)
	if (iso) {
		const [, y, m, d] = iso
		return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
	}

	const slash = s.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2}|19\d{2})\b/)
	if (slash) {
		const a = Number(slash[1])
		const b = Number(slash[2])
		const y = slash[3]
		// Legal filings here are typically D/M/Y. If the first number is >12 it must be day.
		const dayFirst = a > 12 || b <= 12
		const day = dayFirst ? a : b
		const month = dayFirst ? b : a
		if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
			return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
		}
	}

	const cleaned = s.replace(/(\d+)(st|nd|rd|th)/i, '$1').replace(/\bday of\b/i, '')
	const parsed = new Date(cleaned)
	if (!Number.isNaN(parsed.getTime())) {
		const year = parsed.getFullYear()
		if (year >= 1900 && year <= 2100) {
			return parsed.toISOString().slice(0, 10)
		}
	}

	return null
}

const KIND_FALLBACK: Record<EventKind, string> = {
	incident: 'An incident was recorded',
	arrest: 'An arrest took place',
	filing: 'A filing was made',
	hearing: 'A hearing took place',
	judgment: 'Judgment was delivered',
	document: 'Document dated',
	other: 'An event was recorded',
}

export function extractEventSentence(quote: string): string | null {
	const clean = quote.replace(/\u2026/g, ' ').replace(/\s+/g, ' ').trim()
	if (clean.length < 12) return null

	const parts = clean.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean)
	const action =
		/\b(occurred|arrested|filed|heard|delivered|convicted|alleged|took place|lodged|sentenced|reported|complained|appeared)\b/i
	const ranked = [...parts].sort((a, b) => Number(action.test(b)) - Number(action.test(a)))
	let sentence = ranked[0] ?? clean
	sentence = sentence.replace(/^[,;:\s]+/, '').replace(/[,;:\s]+$/, '')
	if (sentence.length < 12) return null
	if (sentence.length > 220) {
		sentence = `${sentence.slice(0, 217).replace(/\s+\S*$/, '')}\u2026`
	}
	return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

export function summarizeEvent(
	quote: string | null,
	kind: EventKind,
	entities: { name: string }[],
	documentType: string,
): string {
	const who = entities
		.slice(0, 2)
		.map((e) => e.name)
		.filter(Boolean)
		.join(' and ')
	const sentence = quote ? extractEventSentence(quote) : null
	if (sentence) {
		const first = who.split(' ')[0]
		if (who && first && !sentence.toLowerCase().includes(first.toLowerCase())) {
			return `${sentence} (${who})`
		}
		return sentence
	}

	const source = documentType.replace(/_/g, ' ')
	if (who) return `${KIND_FALLBACK[kind]} involving ${who}, recorded in the ${source}.`
	return `${KIND_FALLBACK[kind]} in the ${source}.`
}

export function classifyEventKind(window: string): EventKind {
	let best: { kind: EventKind; idx: number } | null = null
	for (const rule of KIND_RULES) {
		const match = window.match(rule.re)
		if (match?.index == null) continue
		if (!best || match.index < best.idx) best = { kind: rule.kind, idx: match.index }
	}
	return best?.kind ?? 'other'
}

export function excerpt(text: string, start: number, end: number, padding = WINDOW): string {
	const begin = Math.max(0, start - padding)
	const finish = Math.min(text.length, end + padding)
	let out = text.slice(begin, finish).replace(/\s+/g, ' ').trim()
	if (begin > 0) out = `\u2026${out}`
	if (finish < text.length) out = `${out}\u2026`
	return out
}

export function extractDatedEvents(text: string, limit = 40): DatedEvent[] {
	if (!text) return []

	const seen = new Set<string>()
	const events: DatedEvent[] = []

	for (const pattern of DATE_PATTERNS) {
		pattern.lastIndex = 0
		let match: RegExpExecArray | null
		while ((match = pattern.exec(text)) !== null) {
			const raw = match[0]
			const date = parseDateToken(raw)
			if (!date) continue
			const start = match.index
			const end = start + raw.length
			const quote = excerpt(text, start, end)
			const key = `${date}:${Math.floor(start / 80)}`
			if (seen.has(key)) continue
			seen.add(key)
			events.push({
				date,
				kind: classifyEventKind(excerpt(text, start, end, KIND_WINDOW)),
				quote,
				start,
				end,
			})
			if (events.length >= limit) return events.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
		}
	}

	return events.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
}

function normalize(s: string): string {
	return s.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim()
}

function participantAliases(p: ParticipantHint): string[] {
	const names = [p.name, p.normalizedName, ...(p.mentions ?? [])]
	return [
		...new Set(
			names
				.map(normalize)
				.filter((n) => n.length > 2 && !/^(the|a|an|his|her|their)\s/.test(n)),
		),
	]
}

function headNoun(phrase: string): string {
	const tokens = normalize(phrase).split(' ').filter(Boolean)
	return tokens[tokens.length - 1] ?? ''
}

function isStructurePhrase(phrase: string): boolean {
	return STRUCTURE_HEADS.has(headNoun(phrase))
}

function collectMatches(text: string, re: RegExp): ReferenceCandidate[] {
	const out: ReferenceCandidate[] = []
	re.lastIndex = 0
	let match: RegExpExecArray | null
	while ((match = re.exec(text)) !== null) {
		out.push({
			reference: match[0].replace(/\s+/g, ' ').trim(),
			start: match.index,
			end: match.index + match[0].length,
		})
	}
	return out
}

/** Open-vocabulary candidates from this document. No per-phrase label list. */
export function discoverReferenceCandidates(text: string): ReferenceCandidate[] {
	if (!text) return []

	const raw = [
		...collectMatches(text, DEFINITE_NP_RE),
		...collectMatches(text, NUMBERED_PARTY_RE),
		...collectMatches(text, POSSESSIVE_NP_RE),
	]

	const filtered = raw.filter((c) => {
		const n = normalize(c.reference)
		if (n.split(' ').length < 2 && !/^(?:pw|dw|io|pc|cpl)\s*\.?\s*\d+$/i.test(n)) return false
		if (isStructurePhrase(c.reference)) return false
		return true
	})

	filtered.sort((a, b) => b.reference.length - a.reference.length || a.start - b.start)

	const kept: ReferenceCandidate[] = []
	for (const c of filtered) {
		if (kept.some((k) => c.start < k.end && c.end > k.start)) continue
		kept.push(c)
	}

	return kept.sort((a, b) => a.start - b.start)
}

function findByExistingMention(
	reference: string,
	participants: ParticipantHint[],
): ParticipantHint | null {
	const n = normalize(reference)
	for (const p of participants) {
		for (const mention of p.mentions ?? []) {
			const m = normalize(mention)
			if (m === n || m.includes(n)) return p
		}
	}
	return null
}

function findByUniqueRoleHead(
	reference: string,
	participants: ParticipantHint[],
): ParticipantHint | null {
	const tokens = new Set(normalize(reference).split(' ').filter(Boolean))
	const matches: ParticipantHint[] = []
	for (const p of participants) {
		const heads = ROLE_HEADS[(p.role || '').toLowerCase()] ?? [p.role]
		if (heads.some((h) => tokens.has(h))) matches.push(p)
	}
	return matches.length === 1 ? matches[0] : null
}

function findNearbyParticipant(
	text: string,
	start: number,
	end: number,
	participants: ParticipantHint[],
): ParticipantHint | null {
	const begin = Math.max(0, start - LINK_WINDOW_BEFORE)
	const finish = Math.min(text.length, end + LINK_WINDOW_AFTER)
	const window = normalize(text.slice(begin, finish))
	if (!window) return null

	let best: { p: ParticipantHint; score: number } | null = null
	for (const p of participants) {
		for (const alias of participantAliases(p)) {
			if (alias.length < 3) continue
			if (!window.includes(alias)) continue
			const score = alias.length
			if (!best || score > best.score) best = { p, score }
		}
	}
	return best?.p ?? null
}

export function linkReferences(text: string, participants: ParticipantHint[]): LinkedReference[] {
	if (!text) return []

	const links: LinkedReference[] = []
	for (const candidate of discoverReferenceCandidates(text)) {
		const fromCoref = findByExistingMention(candidate.reference, participants)
		const nearby = fromCoref
			? null
			: findNearbyParticipant(text, candidate.start, candidate.end, participants)
		const byRole =
			fromCoref || nearby
				? null
				: findByUniqueRoleHead(candidate.reference, participants)
		const attached = fromCoref ?? nearby ?? byRole

		links.push({
			reference: normalize(candidate.reference),
			attachedTo: attached?.normalizedName ?? null,
			attachedName: attached?.name ?? null,
			evidence: excerpt(text, candidate.start, candidate.end),
			confidence: fromCoref ? 0.95 : nearby ? 0.9 : byRole ? 0.7 : 0,
			start: candidate.start,
			end: candidate.end,
		})
	}

	return links
}

export function entitiesNearEvent(
	event: DatedEvent,
	participants: ParticipantHint[],
	links: LinkedReference[],
): ParticipantHint[] {
	const found = new Map<string, ParticipantHint>()

	for (const p of participants) {
		for (const alias of participantAliases(p)) {
			if (alias.length < 3) continue
			if (normalize(event.quote).includes(alias)) {
				found.set(p.normalizedName, p)
			}
		}
	}

	for (const link of links) {
		if (!link.attachedTo) continue
		if (link.end < event.start - WINDOW || link.start > event.end + WINDOW) continue
		const p = participants.find((x) => x.normalizedName === link.attachedTo)
		if (p) found.set(p.normalizedName, p)
	}

	return [...found.values()]
}

export function documentBodyText(doc: {
	coreferenceResolvedContent?: unknown
	fullContent?: unknown
	normalizedText?: string | null
}): string {
	const coref = doc.coreferenceResolvedContent
	if (typeof coref === 'string' && coref.trim()) return coref
	if (coref && typeof coref === 'object') {
		const obj = coref as Record<string, unknown>
		for (const key of ['resolved_text', 'resolvedText', 'content']) {
			if (typeof obj[key] === 'string' && (obj[key] as string).trim()) {
				return obj[key] as string
			}
		}
	}
	const fc = doc.fullContent as { content?: string } | null
	if (fc?.content?.trim()) return fc.content
	return doc.normalizedText ?? ''
}
