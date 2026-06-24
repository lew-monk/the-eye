import { eq } from 'drizzle-orm'
import { BaseRepository } from './base'
import { participants, type Participant, type NewParticipant } from '../schemas'

export class ParticipantRepository extends BaseRepository<Participant, NewParticipant> {
	constructor() {
		super(participants)
	}

	async findByDocumentId(documentId: number): Promise<Participant[]> {
		return this.db
			.select()
			.from(participants)
			.where(eq(participants.documentId, documentId))
	}

	async deleteByDocumentId(documentId: number): Promise<void> {
		await this.db
			.delete(participants)
			.where(eq(participants.documentId, documentId))
	}
}
