import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockDocFindById = mock()
const mockDocFindByCaseId = mock()
const mockChunkFindByDocumentId = mock()
const mockParticipantFindById = mock()
const mockParticipantFindByDocumentId = mock()
const mockParticipantCreate = mock()
const mockParticipantSearch = mock()
const mockCorefFindByDocumentId = mock()
const mockDbExecute = mock()

const mockDb = {
	execute: mockDbExecute,
	select: () => ({
		from: () => ({
			innerJoin: () => ({
				innerJoin: () => ({
					innerJoin: () => ({
						innerJoin: () => ({
							where: () => ({
								orderBy: () => ({
									limit: (n: number) => ({ offset: () => Promise.resolve([]) }),
								}),
							}),
						}),
					}),
				}),
			}),
		}),
	}),
}

mock.module('@workspace/shared', () => ({
	documentRepository: {
		findById: mockDocFindById,
		findByCaseId: mockDocFindByCaseId,
	},
	chunkRepository: {
		findByDocumentId: mockChunkFindByDocumentId,
	},
	participantRepository: {
		findById: mockParticipantFindById,
		findByDocumentId: mockParticipantFindByDocumentId,
		create: mockParticipantCreate,
		search: mockParticipantSearch,
	},
	coreferenceRepository: {
		findByDocumentId: mockCorefFindByDocumentId,
	},
	db: mockDb,
	participants: {},
	documents: {},
	coreferenceResults: {},
	coreferenceClusters: {},
	coreferenceMentions: {},
}))

import { CasesService } from './service'

describe('CasesService.extractDocumentDate', () => {
	it('extracts ISO date from structuredData fields', () => {
		const result = CasesService.extractDocumentDate({
			fields: { date: { valueDate: '2023-06-20' } },
		})
		expect(result).toEqual({ date: '2023-06-20', source: 'structuredData.fields.date' })
	})

	it('extracts US-format date string', () => {
		const result = CasesService.extractDocumentDate({
			filingDate: '03/15/2023',
		})
		expect(result?.date).toBe('2023-03-15')
	})

	it('falls back to createdAt when no structured date', () => {
		const result = CasesService.extractDocumentDate(null, new Date('2024-01-10T12:00:00Z'))
		expect(result).toEqual({ date: '2024-01-10', source: 'createdAt' })
	})

	it('returns null when nothing available', () => {
		expect(CasesService.extractDocumentDate(null, null)).toBeNull()
	})
})

describe('CasesService.matchDocumentReference', () => {
	const docs = [
		{ id: 1, filename: 'police_report.pdf', documentType: 'police_report' },
		{ id: 2, filename: 'witness_affidavit.pdf', documentType: 'affidavit' },
		{ id: 3, filename: 'final_judgment.pdf', documentType: 'judgment' },
	]

	it('matches by document type phrase', () => {
		expect(CasesService.matchDocumentReference('police report', docs, 3)).toBe(1)
	})

	it('matches by filename stem', () => {
		expect(CasesService.matchDocumentReference('witness affidavit', docs, 1)).toBe(2)
	})

	it('does not match source document', () => {
		expect(CasesService.matchDocumentReference('police report', docs, 1)).toBeNull()
	})

	it('returns null for unrelated text', () => {
		expect(CasesService.matchDocumentReference('something else entirely', docs, 1)).toBeNull()
	})
})

describe('CasesService.getDocumentChronology', () => {
	beforeEach(() => {
		mockDocFindByCaseId.mockReset()
		mockParticipantFindByDocumentId.mockReset()
	})

	it('returns events sorted by date with entity appearances', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{
				id: 2,
				filename: 'judgment.pdf',
				documentType: 'judgment',
				structuredData: { fields: { date: { valueDate: '2023-06-20' } } },
				createdAt: new Date('2023-07-01'),
			},
			{
				id: 1,
				filename: 'report.pdf',
				documentType: 'police_report',
				structuredData: { filingDate: '2023-01-15' },
				createdAt: new Date('2023-01-20'),
			},
		])
		mockParticipantFindByDocumentId.mockImplementation((docId: number) => {
			if (docId === 1) {
				return [{ normalizedName: 'jane', name: 'Jane', role: 'witness', mentionCount: 2 }]
			}
			return [{ normalizedName: 'jane', name: 'Jane', role: 'witness', mentionCount: 5 }]
		})

		const result = await CasesService.getDocumentChronology(1)

		expect(result.events).toHaveLength(2)
		expect(result.totalDates).toBe(2)
		expect(result.events[0].documentId).toBe(1)
		expect(result.events[0].date).toBe('2023-01-15')
		expect(result.events[0].kind).toBe('document')
		expect(result.events[1].documentId).toBe(2)
		expect(result.events[1].date).toBe('2023-06-20')
		expect(result.events[0].entities[0].normalizedName).toBe('jane')
	})

	it('returns only the most recent N dates when maxDates is set', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{
				id: 1,
				filename: 'a.pdf',
				documentType: 'other',
				structuredData: { date: '2020-01-01' },
			},
			{
				id: 2,
				filename: 'b.pdf',
				documentType: 'other',
				structuredData: { date: '2021-01-01' },
			},
			{
				id: 3,
				filename: 'c.pdf',
				documentType: 'other',
				structuredData: { date: '2023-01-01' },
			},
		])
		mockParticipantFindByDocumentId.mockResolvedValue([])

		const result = await CasesService.getDocumentChronology(1, { maxDates: 2 })
		expect(result.totalDates).toBe(3)
		expect(result.events.map((e) => e.date)).toEqual(['2021-01-01', '2023-01-01'])
	})

	it('builds a file-text event chronology and links nearby entities', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{
				id: 1,
				filename: 'report.pdf',
				documentType: 'police_report',
				structuredData: null,
				createdAt: new Date('2024-01-01'),
				fullContent: {
					content:
						'The informant Jane Wanjiku said the incident occurred on 12 January 2023. A third party later produced the weapon.',
				},
			},
		])
		mockParticipantFindByDocumentId.mockResolvedValue([
			{
				normalizedName: 'jane wanjiku',
				name: 'Jane Wanjiku',
				role: 'witness',
				mentionCount: 2,
				mentions: ['Jane Wanjiku'],
			},
		])

		const result = await CasesService.getDocumentChronology(1)

		expect(result.events.length).toBeGreaterThanOrEqual(1)
		expect(result.events[0].date).toBe('2023-01-12')
		expect(result.events[0].dateSource).toBe('document_text')
		expect(result.events[0].kind).toBe('incident')
		expect(result.events[0].quote?.toLowerCase()).toContain('occurred')
		expect(result.events[0].entities.some((e) => e.normalizedName === 'jane wanjiku')).toBe(true)
		expect(result.events[0].unresolvedRefs.some((r) => r.includes('third party'))).toBe(true)
	})

	it('skips documents with no extractable date', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{ id: 1, filename: 'x.pdf', documentType: 'other', structuredData: null, createdAt: null },
		])
		const result = await CasesService.getDocumentChronology(1)
		expect(result).toEqual({ events: [], totalEvents: 0, totalDates: 0 })
	})
})

describe('CasesService.getDocumentGraph', () => {
	beforeEach(() => {
		mockDocFindByCaseId.mockReset()
	})

	it('detects explicit cross-references in document text', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{
				id: 1,
				filename: 'police_report.pdf',
				documentType: 'police_report',
				fullContent: { content: 'Initial report of the incident.' },
				coreferenceResolvedContent: null,
				normalizedText: null,
			},
			{
				id: 2,
				filename: 'judgment.pdf',
				documentType: 'judgment',
				fullContent: {
					content: 'As stated in the police report, the defendant fled the scene.',
				},
				coreferenceResolvedContent: null,
				normalizedText: null,
			},
		])

		const result = await CasesService.getDocumentGraph(1)

		expect(result.nodes).toHaveLength(2)
		expect(result.nodes.every((n) => Array.isArray(n.dates))).toBe(true)
		const explicit = result.edges.filter((e) => e.relationType === 'explicit_reference')
		expect(explicit.length).toBeGreaterThanOrEqual(1)
		expect(explicit[0].sourceDocumentId).toBe(2)
		expect(explicit[0].targetDocumentId).toBe(1)
	})

	it('adds implicit subset edges by document type hierarchy', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{
				id: 1,
				filename: 'report.pdf',
				documentType: 'police_report',
				fullContent: null,
				coreferenceResolvedContent: null,
				normalizedText: null,
			},
			{
				id: 2,
				filename: 'aff.pdf',
				documentType: 'affidavit',
				fullContent: null,
				coreferenceResolvedContent: null,
				normalizedText: null,
			},
			{
				id: 3,
				filename: 'judg.pdf',
				documentType: 'judgment',
				fullContent: null,
				coreferenceResolvedContent: null,
				normalizedText: null,
			},
		])

		const result = await CasesService.getDocumentGraph(1)
		const implicit = result.edges.filter((e) => e.relationType === 'implicit_subset')
		expect(implicit.length).toBeGreaterThanOrEqual(1)
	})
})

