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
		expect(result[0]!.normalizedName).toBe('jane')
		expect(result[0]!.primaryRole).toBe('witness')
		expect(result[0]!.roles).toHaveLength(2)
		expect(result[0]!.flag).toContain('defendant')
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
		expect(result[0]!.normalizedName).toBe('alice')
		expect(result[0]!.points).toHaveLength(2)
		expect(result[0]!.points[0]!.documentId).toBe(1)
		expect(result[0]!.points[0]!.mentionCount).toBe(2)
		expect(result[0]!.points[1]!.mentionCount).toBe(8)
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

