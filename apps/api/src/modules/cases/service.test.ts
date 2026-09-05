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

describe('CasesService.getCaseChunks', () => {
	beforeEach(() => {
		mockDocFindByCaseId.mockReset()
		mockChunkFindByDocumentId.mockReset()
	})

	it('returns sorted chunks from all case documents', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{ id: 1, filename: 'doc1.pdf' },
			{ id: 2, filename: 'doc2.pdf' },
		])
		mockChunkFindByDocumentId.mockImplementation((docId: number) => {
			if (docId === 1) return [
				{ id: 10, documentId: 1, chunkIndex: 0, text: 'chunk1', positionWeight: 0.5, embedding: null },
				{ id: 11, documentId: 1, chunkIndex: 1, text: 'chunk2', positionWeight: 0.8, embedding: null },
			]
			return [
				{ id: 20, documentId: 2, chunkIndex: 0, text: 'chunk3', positionWeight: 0.3, embedding: null },
			]
		})

		const result = await CasesService.getCaseChunks(5)

		expect(result.length).toBe(3)
		expect(result[0].positionWeight).toBe(0.8)
		expect(result[1].positionWeight).toBe(0.5)
		expect(result[2].positionWeight).toBe(0.3)
		expect(result[0].filename).toBe('doc1.pdf')
		expect(result[2].filename).toBe('doc2.pdf')
	})

	it('filters out chunks with null positionWeight or text', async () => {
		mockDocFindByCaseId.mockResolvedValue([{ id: 1, filename: 'doc.pdf' }])
		mockChunkFindByDocumentId.mockResolvedValue([
			{ id: 1, documentId: 1, chunkIndex: 0, text: 'valid', positionWeight: 0.5, embedding: null },
			{ id: 2, documentId: 1, chunkIndex: 1, text: null, positionWeight: 0.5, embedding: null },
			{ id: 3, documentId: 1, chunkIndex: 2, text: 'no-weight', positionWeight: null, embedding: null },
			{ id: 4, documentId: 1, chunkIndex: 3, text: 'both-null', positionWeight: null, embedding: null },
		])

		const result = await CasesService.getCaseChunks(1)

		expect(result.length).toBe(1)
		expect(result[0].id).toBe(1)
	})

	it('returns empty array when case has no documents', async () => {
		mockDocFindByCaseId.mockResolvedValue([])
		const result = await CasesService.getCaseChunks(99)
		expect(result).toEqual([])
	})

	it('returns empty array when no chunks have weight', async () => {
		mockDocFindByCaseId.mockResolvedValue([{ id: 1, filename: 'doc.pdf' }])
		mockChunkFindByDocumentId.mockResolvedValue([
			{ id: 1, documentId: 1, chunkIndex: 0, text: 'chunk', positionWeight: null, embedding: null },
		])
		const result = await CasesService.getCaseChunks(1)
		expect(result).toEqual([])
	})

	it('limits result to 50 chunks', async () => {
		mockDocFindByCaseId.mockResolvedValue([{ id: 1, filename: 'big.pdf' }])
		const manyChunks = Array.from({ length: 100 }, (_, i) => ({
			id: i, documentId: 1, chunkIndex: i, text: `chunk-${i}`, positionWeight: (100 - i) / 100, embedding: null,
		}))
		mockChunkFindByDocumentId.mockResolvedValue(manyChunks)

		const result = await CasesService.getCaseChunks(1)

		expect(result.length).toBe(50)
	})
})

describe('CasesService.getMentionContexts', () => {
	const participant = { id: 1, documentId: 10, clusterId: 3, normalizedName: 'john-doe' }

	beforeEach(() => {
		mockParticipantFindById.mockReset()
		mockCorefFindByDocumentId.mockReset()
		mockDocFindById.mockReset()
	})

	it('returns empty array when participant not found', async () => {
		mockParticipantFindById.mockResolvedValue(null)
		const result = await CasesService.getMentionContexts(999)
		expect(result).toEqual([])
	})

	it('returns empty array when participant has no clusterId', async () => {
		mockParticipantFindById.mockResolvedValue({ ...participant, clusterId: null })
		const result = await CasesService.getMentionContexts(1)
		expect(result).toEqual([])
	})

	it('returns empty array when no coreference data found', async () => {
		mockParticipantFindById.mockResolvedValue(participant)
		mockCorefFindByDocumentId.mockResolvedValue(null)
		const result = await CasesService.getMentionContexts(1)
		expect(result).toEqual([])
	})

	it('returns empty array when cluster not found in coref', async () => {
		mockParticipantFindById.mockResolvedValue(participant)
		mockCorefFindByDocumentId.mockResolvedValue({
			clusters: [{ clusterIndex: 1, mentions: [] }],
		})
		const result = await CasesService.getMentionContexts(1)
		expect(result).toEqual([])
	})

	it('returns mention text with context when fullContent available', async () => {
		mockParticipantFindById.mockResolvedValue(participant)
		mockCorefFindByDocumentId.mockResolvedValue({
			clusters: [
				{
					clusterIndex: 3,
					mentions: [
						{ text: 'John', startPos: 10, endPos: 14 },
						{ text: 'John Doe', startPos: 100, endPos: 108 },
					],
				},
			],
		})
		mockDocFindById.mockResolvedValue({
			id: 10,
			fullContent: { content: 'A'.repeat(50) + 'John' + 'B'.repeat(50) + 'John Doe' + 'C'.repeat(50) },
		})

		const result = await CasesService.getMentionContexts(1, 120)

		expect(result.length).toBe(2)
		expect(result[0].text).toBe('John')
		expect(result[0].context).toContain('John')
		expect(result[1].text).toBe('John Doe')
	})

	it('falls back to mention text when no fullContent', async () => {
		mockParticipantFindById.mockResolvedValue(participant)
		mockCorefFindByDocumentId.mockResolvedValue({
			clusters: [
				{
					clusterIndex: 3,
					mentions: [{ text: 'Fallback', startPos: 0, endPos: 8 }],
				},
			],
		})
		mockDocFindById.mockResolvedValue({ id: 10, fullContent: null })

		const result = await CasesService.getMentionContexts(1, 120)

		expect(result.length).toBe(1)
		expect(result[0].text).toBe('Fallback')
		expect(result[0].context).toBe('Fallback')
	})

	it('adds ellipsis prefix when excerpt starts after beginning and no suffix when reaching end', async () => {
		mockParticipantFindById.mockResolvedValue(participant)
		mockCorefFindByDocumentId.mockResolvedValue({
			clusters: [{ clusterIndex: 3, mentions: [{ text: 'Target', startPos: 480, endPos: 486 }] }],
		})
		mockDocFindById.mockResolvedValue({
			id: 10,
			fullContent: { content: 'X'.repeat(500) },
		})

		const result = await CasesService.getMentionContexts(1, 50)

		expect(result[0].context.startsWith('\u2026')).toBe(true)
		expect(result[0].context.endsWith('\u2026')).toBe(false)
	})
	it('prefers resolvedText over fullContent', async () => {
		mockParticipantFindById.mockResolvedValue(participant)
		mockCorefFindByDocumentId.mockResolvedValue({
			resolvedText: 'Z'.repeat(10) + 'John' + 'Z'.repeat(10),
			clusters: [
				{ clusterIndex: 3, mentions: [{ text: 'John', startPos: 10, endPos: 14 }] },
			],
		})
		mockDocFindById.mockResolvedValue({
			id: 10,
			fullContent: { content: 'A'.repeat(50) + 'WRONG' + 'B'.repeat(50) },
		})

		const result = await CasesService.getMentionContexts(1, 5)

		expect(result[0].context).toContain('John')
		expect(result[0].context).not.toContain('WRONG')
	})

	it('adds ellipsis suffix when excerpt ends before text end and no prefix when starting at 0', async () => {
		mockParticipantFindById.mockResolvedValue(participant)
		mockCorefFindByDocumentId.mockResolvedValue({
			clusters: [{ clusterIndex: 3, mentions: [{ text: 'Target', startPos: 0, endPos: 6 }] }],
		})
		mockDocFindById.mockResolvedValue({
			id: 10,
			fullContent: { content: 'X'.repeat(500) },
		})

		const result = await CasesService.getMentionContexts(1, 50)

		expect(result[0].context.startsWith('\u2026')).toBe(false)
		expect(result[0].context.endsWith('\u2026')).toBe(true)
	})
})

describe('CasesService.getEntityMentionContexts', () => {
	it('handles empty db result', async () => {
		mockDb.select = () => ({
			from: () => ({
				innerJoin: () => ({
					innerJoin: () => ({
						innerJoin: () => ({
							innerJoin: () => ({
								where: () => ({
									orderBy: () => Promise.resolve([]),
								}),
							}),
						}),
					}),
				}),
			}),
		})

		const result = await CasesService.getEntityMentionContexts('nonexistent', 1)
		expect(result).toEqual([])
	})
})

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

describe('CasesService.getCaseNetwork', () => {
	beforeEach(() => {
		mockDocFindByCaseId.mockReset()
		mockParticipantFindByDocumentId.mockReset()
	})

	it('builds case, document, role, and entity nodes with edges', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{
				id: 1,
				filename: 'report.pdf',
				documentType: 'police_report',
				caseNumber: 'CASE-AA11',
				fullContent: null,
				coreferenceResolvedContent: null,
				normalizedText: null,
			},
			{
				id: 2,
				filename: 'judgment.pdf',
				documentType: 'judgment',
				caseNumber: 'CASE-AA11',
				fullContent: { content: 'As stated in the police report, Jane testified.' },
				coreferenceResolvedContent: null,
				normalizedText: null,
			},
		])
		mockParticipantFindByDocumentId.mockImplementation((docId: number) => {
			if (docId === 1) {
				return [
					{
						name: 'Jane Wanjiku',
						normalizedName: 'jane_wanjiku',
						role: 'witness',
						mentionCount: 4,
						relevanceScore: 0.8,
					},
					{
						name: 'PC Otieno',
						normalizedName: 'pc_otieno',
						role: 'police',
						mentionCount: 2,
						relevanceScore: 0.4,
					},
				]
			}
			return [
				{
					name: 'Jane Wanjiku',
					normalizedName: 'jane_wanjiku',
					role: 'witness',
					mentionCount: 3,
					relevanceScore: 0.6,
				},
			]
		})

		const result = await CasesService.getCaseNetwork(7)

		expect(result.caseId).toBe(7)
		expect(result.caseNumber).toBe('CASE-AA11')
		expect(result.nodes.some((n) => n.kind === 'case' && n.id === 'case:7')).toBe(true)
		expect(result.nodes.filter((n) => n.kind === 'document')).toHaveLength(2)
		expect(result.nodes.filter((n) => n.kind === 'role').map((n) => n.role).sort()).toEqual([
			'police',
			'witness',
		])
		const jane = result.nodes.find((n) => n.id === 'entity:jane_wanjiku')
		expect(jane?.mentionCount).toBe(7)
		expect(jane?.documentCount).toBe(2)
		expect(result.edges.some((e) => e.kind === 'has_entity' && e.target === 'entity:jane_wanjiku')).toBe(true)
		expect(result.edges.some((e) => e.kind === 'mentioned_in' && e.source === 'entity:jane_wanjiku')).toBe(true)
		expect(result.edges.some((e) => e.kind === 'doc_ref')).toBe(true)
		expect(result.totals.entities).toBe(2)
		expect(result.totals.documents).toBe(2)
		expect(result.totals.roles).toBe(2)
		expect(result.focusId).toBe('case:7')
		expect(result.focusType).toBe('case')
		expect(result.totals.cases).toBe(1)
	})

	it('caps entities and reports hidden count', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{
				id: 1,
				filename: 'a.pdf',
				documentType: 'other',
				caseNumber: 'CASE-1',
				fullContent: null,
				coreferenceResolvedContent: null,
				normalizedText: null,
			},
		])
		mockParticipantFindByDocumentId.mockResolvedValue(
			Array.from({ length: 6 }, (_, i) => ({
				name: `Person ${i}`,
				normalizedName: `person_${i}`,
				role: 'other',
				mentionCount: 6 - i,
				relevanceScore: 0.1,
			})),
		)

		const result = await CasesService.getCaseNetwork(1, 3)
		expect(result.nodes.filter((n) => n.kind === 'entity')).toHaveLength(3)
		expect(result.totals.entities).toBe(6)
		expect(result.totals.hiddenEntities).toBe(3)
	})
})

describe('CasesService.getFocusNetwork', () => {
	beforeEach(() => {
		mockDocFindById.mockReset()
		mockDocFindByCaseId.mockReset()
		mockParticipantFindByDocumentId.mockReset()
		mockParticipantSearch.mockReset()
	})

	it('builds an entity network across cases and documents', async () => {
		mockParticipantSearch.mockResolvedValue({
			data: [
				{
					name: 'Jane Wanjiku',
					normalizedName: 'jane_wanjiku',
					documentId: 1,
					caseId: 10,
					caseNumber: 'CASE-A',
					documentType: 'affidavit',
					role: 'witness',
					mentionCount: 4,
				},
				{
					name: 'Jane Wanjiku',
					normalizedName: 'jane_wanjiku',
					documentId: 2,
					caseId: 11,
					caseNumber: 'CASE-B',
					documentType: 'judgment',
					role: 'witness',
					mentionCount: 2,
				},
			],
			total: 2,
		})
		mockDocFindById.mockImplementation((id: number) => ({
			id,
			filename: id === 1 ? 'aff.pdf' : 'judg.pdf',
			documentType: id === 1 ? 'affidavit' : 'judgment',
			caseId: id === 1 ? 10 : 11,
			caseNumber: id === 1 ? 'CASE-A' : 'CASE-B',
		}))
		mockParticipantFindByDocumentId.mockImplementation((docId: number) => [
			{
				name: 'Jane Wanjiku',
				normalizedName: 'jane_wanjiku',
				role: 'witness',
				mentionCount: 2,
			},
			{
				name: 'PC Otieno',
				normalizedName: 'pc_otieno',
				role: 'police',
				mentionCount: 1,
			},
		])

		const result = await CasesService.getFocusNetwork({ type: 'entity', id: 'jane_wanjiku' })
		expect(result).not.toBeNull()
		expect(result!.focusId).toBe('entity:jane_wanjiku')
		expect(result!.nodes.filter((n) => n.kind === 'case')).toHaveLength(2)
		expect(result!.nodes.filter((n) => n.kind === 'document')).toHaveLength(2)
		expect(result!.nodes.some((n) => n.id === 'entity:pc_otieno')).toBe(true)
		expect(result!.edges.some((e) => e.kind === 'in_case')).toBe(true)
		expect(result!.edges.some((e) => e.kind === 'co_occurs')).toBe(true)
		expect(result!.totals.cases).toBe(2)
	})

	it('builds a document network with case, siblings, and entities', async () => {
		mockDocFindById.mockResolvedValue({
			id: 1,
			filename: 'aff.pdf',
			documentType: 'affidavit',
			caseId: 5,
			caseNumber: 'CASE-5',
			fullContent: null,
			coreferenceResolvedContent: null,
			normalizedText: null,
		})
		mockDocFindByCaseId.mockResolvedValue([
			{
				id: 1,
				filename: 'aff.pdf',
				documentType: 'affidavit',
				caseNumber: 'CASE-5',
				fullContent: null,
				coreferenceResolvedContent: null,
				normalizedText: null,
			},
			{
				id: 2,
				filename: 'judg.pdf',
				documentType: 'judgment',
				caseNumber: 'CASE-5',
				fullContent: { content: 'As stated in the affidavit, Jane testified.' },
				coreferenceResolvedContent: null,
				normalizedText: null,
			},
		])
		mockParticipantFindByDocumentId.mockResolvedValue([
			{
				name: 'Jane Wanjiku',
				normalizedName: 'jane_wanjiku',
				role: 'witness',
				mentionCount: 3,
			},
		])

		const result = await CasesService.getFocusNetwork({ type: 'document', id: '1' })
		expect(result).not.toBeNull()
		expect(result!.focusId).toBe('doc:1')
		expect(result!.nodes.some((n) => n.id === 'case:5')).toBe(true)
		expect(result!.nodes.some((n) => n.id === 'doc:2')).toBe(true)
		expect(result!.nodes.some((n) => n.id === 'entity:jane_wanjiku')).toBe(true)
		expect(result!.edges.some((e) => e.kind === 'doc_ref')).toBe(true)
	})
})

describe('CasesService.getRoleVarianceFlags', () => {
	beforeEach(() => {
		mockDocFindByCaseId.mockReset()
		mockParticipantFindByDocumentId.mockReset()
	})

	it('flags entities whose role changes across documents', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{ id: 1, filename: 'a.pdf' },
			{ id: 2, filename: 'b.pdf' },
			{ id: 3, filename: 'c.pdf' },
		])
		mockParticipantFindByDocumentId.mockImplementation((docId: number) => {
			if (docId === 1) return [{ normalizedName: 'jane', name: 'Jane Smith', role: 'witness' }]
			if (docId === 2) return [{ normalizedName: 'jane', name: 'Jane Smith', role: 'witness' }]
			return [{ normalizedName: 'jane', name: 'Jane Smith', role: 'defendant' }]
		})

		const result = await CasesService.getRoleVarianceFlags(1)

		expect(result).toHaveLength(1)
		expect(result[0].normalizedName).toBe('jane')
		expect(result[0].primaryRole).toBe('witness')
		expect(result[0].roles).toHaveLength(2)
		expect(result[0].flag).toContain('defendant')
	})

	it('returns empty when all roles are consistent', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{ id: 1, filename: 'a.pdf' },
			{ id: 2, filename: 'b.pdf' },
		])
		mockParticipantFindByDocumentId.mockResolvedValue([
			{ normalizedName: 'bob', name: 'Bob', role: 'judge' },
		])

		const result = await CasesService.getRoleVarianceFlags(1)
		expect(result).toEqual([])
	})
})

describe('CasesService.getEntityTrajectories', () => {
	beforeEach(() => {
		mockDocFindByCaseId.mockReset()
		mockParticipantFindByDocumentId.mockReset()
	})

	it('plots mention counts across documents in chronological order', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{
				id: 2,
				filename: 'later.pdf',
				documentType: 'judgment',
				structuredData: { date: '2023-06-01' },
				createdAt: new Date('2023-06-02'),
			},
			{
				id: 1,
				filename: 'early.pdf',
				documentType: 'police_report',
				structuredData: { date: '2023-01-01' },
				createdAt: new Date('2023-01-02'),
			},
		])
		mockParticipantFindByDocumentId.mockImplementation((docId: number) => {
			if (docId === 1) {
				return [{ normalizedName: 'alice', name: 'Alice', role: 'witness', mentionCount: 2 }]
			}
			return [{ normalizedName: 'alice', name: 'Alice', role: 'witness', mentionCount: 8 }]
		})

		const result = await CasesService.getEntityTrajectories(1)

		expect(result).toHaveLength(1)
		expect(result[0].normalizedName).toBe('alice')
		expect(result[0].points).toHaveLength(2)
		expect(result[0].points[0].documentId).toBe(1)
		expect(result[0].points[0].mentionCount).toBe(2)
		expect(result[0].points[1].mentionCount).toBe(8)
	})
})

describe('CasesService.getIntelligenceGraph', () => {
	beforeEach(() => {
		mockDocFindByCaseId.mockReset()
		mockParticipantFindByDocumentId.mockReset()
	})

	it('emits role-variance and mention-drop signal nodes', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{
				id: 1,
				filename: 'early.pdf',
				documentType: 'police_report',
				caseNumber: 'CASE-1',
				structuredData: { date: '2023-01-01' },
				fullContent: null,
				coreferenceResolvedContent: null,
				normalizedText: null,
			},
			{
				id: 2,
				filename: 'later.pdf',
				documentType: 'judgment',
				caseNumber: 'CASE-1',
				structuredData: { date: '2023-06-01' },
				fullContent: null,
				coreferenceResolvedContent: null,
				normalizedText: null,
			},
		])
		mockParticipantFindByDocumentId.mockImplementation((docId: number) => {
			if (docId === 1) {
				return [{ normalizedName: 'alice', name: 'Alice', role: 'witness', mentionCount: 10 }]
			}
			return [{ normalizedName: 'alice', name: 'Alice', role: 'defendant', mentionCount: 2 }]
		})

		const result = await CasesService.getIntelligenceGraph(1)
		expect(result.focusId).toBe('case:1')
		expect(result.nodes.some((n) => n.kind === 'signal' && n.signal === 'role_variance')).toBe(true)
		expect(result.nodes.some((n) => n.kind === 'signal' && n.signal === 'drop')).toBe(true)
		expect(result.nodes.some((n) => n.id === 'entity:alice')).toBe(true)
		expect(result.edges.some((e) => e.kind === 'has_signal')).toBe(true)
		expect(result.edges.some((e) => e.kind === 'about')).toBe(true)
	})
})

describe('CasesService.getCaseEntities', () => {
	beforeEach(() => {
		mockDocFindByCaseId.mockReset()
		mockParticipantFindByDocumentId.mockReset()
		mockDbExecute.mockReset()
	})

	it('aggregates entities by normalizedName and attaches confidence', async () => {
		mockDocFindByCaseId.mockResolvedValue([
			{ id: 1, filename: 'a.pdf' },
			{ id: 2, filename: 'b.pdf' },
		])
		mockParticipantFindByDocumentId.mockImplementation((docId: number) => {
			if (docId === 1) {
				return [{
					id: 10,
					name: 'Jane Smith',
					normalizedName: 'jane-smith',
					role: 'witness',
					roleConfidence: 0.9,
					mentionCount: 3,
					relevanceScore: 0.6,
					mentions: ['Jane'],
				}]
			}
			return [{
				id: 11,
				name: 'Jane Smith',
				normalizedName: 'jane-smith',
				role: 'witness',
				roleConfidence: 0.8,
				mentionCount: 2,
				relevanceScore: 0.9,
				mentions: ['Jane Smith'],
			}]
		})

		// EntityService.getConfidence db calls
		mockDbExecute
			.mockResolvedValueOnce([{ role: 'witness', count: 2, documents: 2 }])
			.mockResolvedValueOnce([{ total: 2 }])
			.mockResolvedValueOnce([{ case_id: 1, case_total: 2 }])

		const result = await CasesService.getCaseEntities(5)

		expect(result).toHaveLength(1)
		expect(result[0].normalizedName).toBe('jane-smith')
		expect(result[0].documentCount).toBe(2)
		expect(result[0].mentionCount).toBe(5)
		expect(result[0].totalDocsInCase).toBe(2)
		expect(result[0].relevanceScore).toBe(0.9)
		expect(result[0].confidence.score).toBeGreaterThan(0)
		expect(result[0].confidence.roleConsistency).toBe(100)
	})

	it('returns empty array when case has no documents', async () => {
		mockDocFindByCaseId.mockResolvedValue([])
		const result = await CasesService.getCaseEntities(99)
		expect(result).toEqual([])
	})
})

describe('CasesService.addManualParticipant', () => {
	beforeEach(() => {
		mockDocFindByCaseId.mockReset()
		mockParticipantCreate.mockReset()
	})

	it('creates a participant on the first document when documentId omitted', async () => {
		mockDocFindByCaseId.mockResolvedValue([{ id: 7, filename: 'a.pdf' }])
		mockParticipantCreate.mockResolvedValue({ id: 1, name: 'Ada Lovelace' })

		await CasesService.addManualParticipant(3, { name: 'Ada Lovelace', role: 'witness' })

		expect(mockParticipantCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				documentId: 7,
				name: 'Ada Lovelace',
				normalizedName: 'ada lovelace',
				role: 'witness',
			}),
		)
	})

	it('rejects when the case has no documents', async () => {
		mockDocFindByCaseId.mockResolvedValue([])
		await expect(CasesService.addManualParticipant(3, { name: 'Ada' })).rejects.toThrow(
			'Case has no documents',
		)
	})
})
