// Re-export all repositories for convenience
export * from './repositories'

// Create singleton instances for common repositories
import { DocumentRepository } from './repositories'

export const documentRepository = new DocumentRepository()
