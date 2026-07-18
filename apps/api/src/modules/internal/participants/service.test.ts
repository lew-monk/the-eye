import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockDocFindById = mock()
const mockDocUpdateById = mock().mockResolvedValue({})
const mockDocAddProcessingLog = mock().mockResolvedValue(undefined)

const mockParticipantDeleteByDocumentId = mock().mockResolvedValue(undefined)
const mockParticipantCreateMany = mock()
const mockParticipantFindCaseEntityOverlap = mock()
const mockParticipantFindByCaseIdAndNormalizedNames = mock()
const mockParticipantUpdateById = mock()

mock.module('@workspace/shared', () => ({
	documentRepository: {
		findById: mockDocFindById,
		updateById: mockDocUpdateById,
		addProcessingLog: mockDocAddProcessingLog,
	},
	participantRepository: {
		findById: mock(),
		findByDocumentId: mock(),
		deleteByDocumentId: mockParticipantDeleteByDocumentId,
		createMany: mockParticipantCreateMany,
		findCaseEntityOverlap: mockParticipantFindCaseEntityOverlap,
		findByCaseIdAndNormalizedNames: mockParticipantFindByCaseIdAndNormalizedNames,
		updateById: mockParticipantUpdateById,
	},
}))

import { ParticipantsService } from './service'

function inserted(overrides: Array<Partial<{ id: number; normalizedName: string; relevanceScore: number | null }>>) {
	return overrides.map((p, i) => ({
		id: p.id ?? i + 1,
		normalizedName: p.normalizedName ?? `entity-${i + 1}`,
		relevanceScore: p.relevanceScore ?? null,
	}))
}

describe('ParticipantsService.store()', () => {
	const DOC_ID = 10
	const VERSION = 1

	beforeEach(() => {
		mockDocFindById.mockReset()
		mockDocUpdateById.mockReset()
		mockDocAddProcessingLog.mockReset()
		mockParticipantDeleteByDocumentId.mockReset()
		mockParticipantCreateMany.mockReset()
		mockParticipantFindCaseEntityOverlap.mockReset()
		mockParticipantFindByCaseIdAndNormalizedNames.mockReset()
		mockParticipantUpdateById.mockReset()

		mockDocUpdateById.mockResolvedValue({})
		mockDocAddProcessingLog.mockResolvedValue(undefined)
		mockParticipantDeleteByDocumentId.mockResolvedValue(undefined)
		mockParticipantUpdateById.mockResolvedValue({})
	})

	it('returns null when document is not found', async () => {
		mockDocFindById.mockResolvedValue(null)

		const result = await ParticipantsService.store(DOC_ID, [], VERSION)

		expect(result).toBeNull()
		expect(mockParticipantDeleteByDocumentId).not.toHaveBeenCalled()
		expect(mockParticipantCreateMany).not.toHaveBeenCalled()
	})

	it('stores participants and skips recalibration when document has no caseId', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, caseId: null })
		const records = inserted([{ normalizedName: 'john-doe', relevanceScore: 0.7 }])
		mockParticipantCreateMany.mockResolvedValue(records)

		const result = await ParticipantsService.store(DOC_ID, [{ name: 'John Doe', normalizedName: 'john-doe' }], VERSION)

		expect(result).toEqual({ count: 1 })
		expect(mockParticipantDeleteByDocumentId).toHaveBeenCalledWith(DOC_ID)
		expect(mockParticipantCreateMany).toHaveBeenCalled()
		expect(mockDocUpdateById).toHaveBeenCalled()
		expect(mockDocAddProcessingLog).toHaveBeenCalledTimes(1)
		expect(mockDocAddProcessingLog.mock.calls[0]?.[0]?.action).toBe('participants_extracted')
		expect(mockParticipantFindCaseEntityOverlap).not.toHaveBeenCalled()
	})

	it('does not change scores when case has only one document', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, caseId: 5 })
		const records = inserted([{ normalizedName: 'judge-smith', relevanceScore: 0.85 }])
		mockParticipantCreateMany.mockResolvedValue(records)
		mockParticipantFindCaseEntityOverlap.mockResolvedValue([])

		await ParticipantsService.store(DOC_ID, [{ name: 'Judge Smith', normalizedName: 'judge-smith', relevanceScore: 0.85 }], VERSION)

		const updateCalls = mockParticipantUpdateById.mock.calls
		expect(updateCalls.length).toBe(1)
		expect(updateCalls[0]?.[1]?.relevanceScore).toBe(0.85)
	})

	it('applies bonus when entity appears in 2 of 3 documents', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, caseId: 5 })
		const records = inserted([{ normalizedName: 'lawyer-kamau', relevanceScore: 0.7 }])
		mockParticipantCreateMany.mockResolvedValue(records)
		mockParticipantFindCaseEntityOverlap.mockResolvedValue([
			{ participantId: 1, normalizedName: 'lawyer-kamau', docCount: 2, totalDocsInCase: 3, mentionCountAcrossCase: 12 },
		])
		mockParticipantFindByCaseIdAndNormalizedNames.mockResolvedValue([])

		await ParticipantsService.store(DOC_ID, [{ name: 'Lawyer Kamau', normalizedName: 'lawyer-kamau', relevanceScore: 0.7 }], VERSION)

		const updateCalls = mockParticipantUpdateById.mock.calls
		expect(updateCalls.length).toBe(1)
		// bonus = ((2 - 1) / 3) * 0.5 = 0.166... , 0.7 + 0.166 = 0.866..., capped at 1
		expect(updateCalls[0]?.[1]?.relevanceScore).toBeCloseTo(0.867, 2)
	})

	it('applies max bonus when entity appears in all 3 documents', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, caseId: 5 })
		const records = inserted([{ normalizedName: 'defendant-kariuki', relevanceScore: 0.6 }])
		mockParticipantCreateMany.mockResolvedValue(records)
		mockParticipantFindCaseEntityOverlap.mockResolvedValue([
			{ participantId: 1, normalizedName: 'defendant-kariuki', docCount: 3, totalDocsInCase: 3, mentionCountAcrossCase: 30 },
		])
		mockParticipantFindByCaseIdAndNormalizedNames.mockResolvedValue([])

		await ParticipantsService.store(DOC_ID, [{ name: 'Defendant Kariuki', normalizedName: 'defendant-kariuki', relevanceScore: 0.6 }], VERSION)

		const updateCalls = mockParticipantUpdateById.mock.calls
		expect(updateCalls.length).toBe(1)
		// bonus = ((3 - 1) / 3) * 0.5 = 0.333..., 0.6 + 0.333 = 0.933...
		expect(updateCalls[0]?.[1]?.relevanceScore).toBeCloseTo(0.933, 2)
	})

	it('caps bonus at 1.0 for already-high scores', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, caseId: 5 })
		const records = inserted([{ normalizedName: 'judge-wanjiku', relevanceScore: 0.9 }])
		mockParticipantCreateMany.mockResolvedValue(records)
		mockParticipantFindCaseEntityOverlap.mockResolvedValue([
			{ participantId: 1, normalizedName: 'judge-wanjiku', docCount: 3, totalDocsInCase: 3, mentionCountAcrossCase: 15 },
		])
		mockParticipantFindByCaseIdAndNormalizedNames.mockResolvedValue([])

		await ParticipantsService.store(DOC_ID, [{ name: 'Judge Wanjiku', normalizedName: 'judge-wanjiku', relevanceScore: 0.9 }], VERSION)

		const updateCalls = mockParticipantUpdateById.mock.calls
		// bonus = 0.333, 0.9 + 0.333 = 1.233 → capped at 1
		expect(updateCalls[0]?.[1]?.relevanceScore).toBe(1)
	})

	it('treats null baseScore as 0', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, caseId: 5 })
		const records = inserted([{ normalizedName: 'unknown-entity', relevanceScore: null }])
		mockParticipantCreateMany.mockResolvedValue(records)
		mockParticipantFindCaseEntityOverlap.mockResolvedValue([
			{ participantId: 1, normalizedName: 'unknown-entity', docCount: 2, totalDocsInCase: 3, mentionCountAcrossCase: 5 },
		])
		mockParticipantFindByCaseIdAndNormalizedNames.mockResolvedValue([])

		await ParticipantsService.store(DOC_ID, [{ name: 'Unknown Entity', normalizedName: 'unknown-entity' }], VERSION)

		const updateCalls = mockParticipantUpdateById.mock.calls
		// bonus = ((2-1)/3)*0.5 = 0.166..., 0 + 0.166 = 0.166...
		expect(updateCalls[0]?.[1]?.relevanceScore).toBeCloseTo(0.167, 2)
	})

	it('does not change score for non-overlapping entities', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, caseId: 5 })
		const records = inserted([
			{ normalizedName: 'overlapping', relevanceScore: 0.8 },
			{ normalizedName: 'unique', relevanceScore: 0.4 },
		])
		mockParticipantCreateMany.mockResolvedValue(records)
		mockParticipantFindCaseEntityOverlap.mockResolvedValue([
			{ participantId: 1, normalizedName: 'overlapping', docCount: 2, totalDocsInCase: 3, mentionCountAcrossCase: 20 },
		])
		mockParticipantFindByCaseIdAndNormalizedNames.mockResolvedValue([])

		await ParticipantsService.store(DOC_ID, [
			{ name: 'Overlapping', normalizedName: 'overlapping', relevanceScore: 0.8 },
			{ name: 'Unique', normalizedName: 'unique', relevanceScore: 0.4 },
		], VERSION)

		const updateCalls = mockParticipantUpdateById.mock.calls
		expect(updateCalls.length).toBe(2)

		const overlappingCall = updateCalls.find((c: any) => c[0] === 1)
		const uniqueCall = updateCalls.find((c: any) => c[0] === 2)

		expect(overlappingCall?.[1]?.relevanceScore).toBeCloseTo(0.967, 2)
		expect(uniqueCall?.[1]?.relevanceScore).toBe(0.4)
	})

	it('updates existing participants in other documents of the case (bidirectional)', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, caseId: 5 })
		const newRecords = inserted([{ id: 100, normalizedName: 'kamau', relevanceScore: 0.7 }])
		mockParticipantCreateMany.mockResolvedValue(newRecords)
		mockParticipantFindCaseEntityOverlap.mockResolvedValue([
			{ participantId: 100, normalizedName: 'kamau', docCount: 3, totalDocsInCase: 3, mentionCountAcrossCase: 25 },
		])
		mockParticipantFindByCaseIdAndNormalizedNames.mockResolvedValue([
			{ id: 100, normalizedName: 'kamau', relevanceScore: 0.7, documentId: DOC_ID },
			{ id: 200, normalizedName: 'kamau', relevanceScore: 0.55, documentId: 11 },
			{ id: 300, normalizedName: 'kamau', relevanceScore: 0.6, documentId: 12 },
		])

		await ParticipantsService.store(DOC_ID, [{ name: 'Kamau', normalizedName: 'kamau', relevanceScore: 0.7 }], VERSION)

		const updateCalls = mockParticipantUpdateById.mock.calls
		expect(updateCalls.length).toBe(3)

		const update100 = updateCalls.find((c: any) => c[0] === 100)
		const update200 = updateCalls.find((c: any) => c[0] === 200)
		const update300 = updateCalls.find((c: any) => c[0] === 300)

		// bonus = ((3-1)/3)*0.5 = 0.333
		// participant 100: 0.7 + 0.333 = 1.033 → capped at 1
		expect(update100?.[1]?.relevanceScore).toBe(1)
		expect(update200?.[1]?.relevanceScore).toBeCloseTo(0.883, 2)
		expect(update300?.[1]?.relevanceScore).toBeCloseTo(0.933, 2)
	})

	it('skips bidirectional updates when no names overlap', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, caseId: 5 })
		const records = inserted([{ normalizedName: 'unique-entity', relevanceScore: 0.5 }])
		mockParticipantCreateMany.mockResolvedValue(records)
		mockParticipantFindCaseEntityOverlap.mockResolvedValue([])

		await ParticipantsService.store(DOC_ID, [{ name: 'Unique Entity', normalizedName: 'unique-entity', relevanceScore: 0.5 }], VERSION)

		expect(mockParticipantFindByCaseIdAndNormalizedNames).not.toHaveBeenCalled()
	})

	it('handles empty participants array', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, caseId: 5 })
		mockParticipantCreateMany.mockResolvedValue([])
		mockParticipantFindCaseEntityOverlap.mockResolvedValue([])

		const result = await ParticipantsService.store(DOC_ID, [], VERSION)

		expect(result).toEqual({ count: 0 })
		expect(mockParticipantFindCaseEntityOverlap).toHaveBeenCalledWith(DOC_ID, 5)
		expect(mockParticipantUpdateById).not.toHaveBeenCalled()
	})

	it('logs recalibration with correct metadata', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, caseId: 5 })
		const records = inserted([{ normalizedName: 'kamau', relevanceScore: 0.7 }])
		mockParticipantCreateMany.mockResolvedValue(records)
		mockParticipantFindCaseEntityOverlap.mockResolvedValue([
			{ participantId: 1, normalizedName: 'kamau', docCount: 2, totalDocsInCase: 2, mentionCountAcrossCase: 10 },
		])
		mockParticipantFindByCaseIdAndNormalizedNames.mockResolvedValue([
			{ id: 1, normalizedName: 'kamau', relevanceScore: 0.7, documentId: DOC_ID },
		])

		await ParticipantsService.store(DOC_ID, [{ name: 'Kamau', normalizedName: 'kamau', relevanceScore: 0.7 }], VERSION)

		const extractionLog = mockDocAddProcessingLog.mock.calls.find(
			(c: any) => c[0]?.action === 'participants_extracted',
		)
		const recalibrationLog = mockDocAddProcessingLog.mock.calls.find(
			(c: any) => c[0]?.action === 'participants_recalibrated',
		)

		expect(extractionLog).toBeDefined()
		expect(extractionLog?.[0]?.details?.count).toBe(1)

		expect(recalibrationLog).toBeDefined()
		expect(recalibrationLog?.[0]?.details?.caseId).toBe(5)
		expect(recalibrationLog?.[0]?.details?.overlappingEntities).toBe(1)
		expect(recalibrationLog?.[0]?.details?.totalParticipants).toBe(1)
		expect(recalibrationLog?.[0]?.details?.bidiUpdates).toBe(0)
	})

	it('reports correct bidiUpdates count', async () => {
		mockDocFindById.mockResolvedValue({ id: DOC_ID, caseId: 5 })
		const records = inserted([{ id: 100, normalizedName: 'kamau', relevanceScore: 0.7 }])
		mockParticipantCreateMany.mockResolvedValue(records)
		mockParticipantFindCaseEntityOverlap.mockResolvedValue([
			{ participantId: 100, normalizedName: 'kamau', docCount: 2, totalDocsInCase: 2, mentionCountAcrossCase: 10 },
		])
		mockParticipantFindByCaseIdAndNormalizedNames.mockResolvedValue([
			{ id: 100, normalizedName: 'kamau', relevanceScore: 0.7 },
			{ id: 200, normalizedName: 'kamau', relevanceScore: 0.6 },
		])

		await ParticipantsService.store(DOC_ID, [{ name: 'Kamau', normalizedName: 'kamau', relevanceScore: 0.7 }], VERSION)

		const recalibrationLog = mockDocAddProcessingLog.mock.calls.find(
			(c: any) => c[0]?.action === 'participants_recalibrated',
		)
		expect(recalibrationLog?.[0]?.details?.bidiUpdates).toBe(1)
	})
})
