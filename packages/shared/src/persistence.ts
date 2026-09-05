// Re-export all repositories for convenience
export * from './repositories'

// Create singleton instances for common repositories
import { DocumentRepository, ParticipantRepository, DocumentChunkRepository, CaseRepository, CaseRelationRepository } from './repositories'

export const documentRepository = new DocumentRepository()
export const participantRepository = new ParticipantRepository()
export const chunkRepository = new DocumentChunkRepository()
export const caseRepository = new CaseRepository()
export const caseRelationRepository = new CaseRelationRepository()
