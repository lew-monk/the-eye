import { describe, expect, it } from 'bun:test'
import {
	classifyEventKind,
	discoverReferenceCandidates,
	documentBodyText,
	entitiesNearEvent,
	extractDatedEvents,
	linkReferences,
	parseDateToken,
	summarizeEvent,
} from './linker'

const jane = {
	name: 'Jane Wanjiku',
	normalizedName: 'jane wanjiku',
	role: 'witness',
	mentions: ['Jane', 'the informant Jane Wanjiku'],
}

const kamau = {
	name: 'John Kamau',
	normalizedName: 'john kamau',
	role: 'defendant',
	mentions: ['Kamau'],
}

describe('parseDateToken', () => {
	it('parses ISO and US dates', () => {
		expect(parseDateToken('2023-06-20')).toBe('2023-06-20')
		expect(parseDateToken('03/15/2023')).toBe('2023-03-15')
	})

	it('parses long legal dates', () => {
		expect(parseDateToken('15th January 2023')).toBe('2023-01-15')
		expect(parseDateToken('15th day of January, 2023')).toBe('2023-01-15')
	})
})

describe('extractDatedEvents', () => {
	it('pulls dated events and classifies them from nearby words', () => {
		const text =
			'The incident occurred on 12 January 2023 at midnight. ' +
			'The accused was arrested on 13/01/2023. ' +
			'Judgment was delivered on 20 June 2023.'
		const events = extractDatedEvents(text)
		expect(events.map((e) => e.date)).toEqual(['2023-01-12', '2023-01-13', '2023-06-20'])
		expect(events[0].kind).toBe('incident')
		expect(events[1].kind).toBe('arrest')
		expect(events[2].kind).toBe('judgment')
		expect(events[0].quote.toLowerCase()).toContain('occurred')
	})

	it('returns empty for text with no dates', () => {
		expect(extractDatedEvents('No calendar information here.')).toEqual([])
	})
})

describe('summarizeEvent', () => {
	it('pulls the action sentence from the quote', () => {
		const summary = summarizeEvent(
			'The incident occurred on 12 January 2023 at midnight.',
			'incident',
			[{ name: 'Jane Wanjiku' }],
			'police_report',
		)
		expect(summary.toLowerCase()).toContain('occurred')
		expect(summary.toLowerCase()).toContain('jane')
	})

	it('falls back to a kind + actors line when there is no quote', () => {
		const summary = summarizeEvent(null, 'arrest', [{ name: 'John Kamau' }], 'police_report')
		expect(summary.toLowerCase()).toContain('arrest')
		expect(summary).toContain('John Kamau')
	})
})

describe('classifyEventKind', () => {
	it('defaults to other', () => {
		expect(classifyEventKind('something happened then')).toBe('other')
	})
})

describe('discoverReferenceCandidates', () => {
	it('finds unseen phrases without a hardcoded label list', () => {
		const text =
			'The village elder and PW14 spoke after the 4th accused sat down. The court then rose.'
		const refs = discoverReferenceCandidates(text).map((c) => normalizeLoose(c.reference))
		expect(refs.some((r) => r.includes('village elder'))).toBe(true)
		expect(refs.some((r) => r.replace(/\s/g, '') === 'pw14')).toBe(true)
		expect(refs.some((r) => r.includes('4th accused'))).toBe(true)
		expect(refs.some((r) => r === 'the court')).toBe(false)
	})
})

function normalizeLoose(s: string) {
	return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

describe('linkReferences', () => {
	it('attaches a nearby named mention', () => {
		const text = 'The informant Jane Wanjiku reported the theft to the station.'
		const links = linkReferences(text, [jane, kamau])
		const informant = links.find((l) => l.reference.includes('informant'))
		expect(informant?.attachedTo).toBe('jane wanjiku')
		expect(informant!.confidence).toBeGreaterThanOrEqual(0.9)
	})

	it('attaches a unique role head without a phrase list', () => {
		const text = 'The accused was taken into custody that night.'
		const links = linkReferences(text, [jane, kamau])
		const accused = links.find((l) => l.reference.includes('accused'))
		expect(accused?.attachedTo).toBe('john kamau')
		expect(accused!.confidence).toBeGreaterThan(0)
	})

	it('leaves novel references unresolved instead of guessing', () => {
		const text = 'A third party later produced the weapon. Her brother stayed outside.'
		const links = linkReferences(text, [jane, kamau])
		const third = links.find((l) => l.reference.includes('third party'))
		const brother = links.find((l) => l.reference.includes('brother'))
		expect(third?.attachedTo).toBeNull()
		expect(brother?.attachedTo).toBeNull()
	})
})

describe('entitiesNearEvent', () => {
	it('includes a linked entity that sits in the event window', () => {
		const text =
			'The informant Jane Wanjiku said the incident occurred on 12 January 2023.'
		const events = extractDatedEvents(text)
		const links = linkReferences(text, [jane, kamau])
		const near = entitiesNearEvent(events[0], [jane, kamau], links)
		expect(near.map((p) => p.normalizedName)).toContain('jane wanjiku')
	})
})

describe('documentBodyText', () => {
	it('prefers resolved text then OCR content', () => {
		expect(
			documentBodyText({
				coreferenceResolvedContent: { resolved_text: 'resolved' },
				fullContent: { content: 'ocr' },
			}),
		).toBe('resolved')
		expect(documentBodyText({ fullContent: { content: 'ocr' } })).toBe('ocr')
	})
})
