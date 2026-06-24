import { documentRepository, participantRepository } from '@workspace/shared'

export abstract class ParticipantsService {
	static async store(documentId: number, participants: any[], extractionVersion: number) {
		const document = await documentRepository.findById(documentId)
		if (!document) return null

		const rows = participants.map((p) => ({
			...p,
			documentId,
			extractionVersion,
		}))

		await participantRepository.deleteByDocumentId(documentId)
		const inserted = await participantRepository.createMany(rows)

		await documentRepository.updateById(documentId, {
			extractionVersion,
		} as any)

		await documentRepository.addProcessingLog({
			documentId,
			action: 'participants_extracted',
			details: {
				count: inserted.length,
				version: extractionVersion,
			},
		})

		return { count: inserted.length }
	}
}
