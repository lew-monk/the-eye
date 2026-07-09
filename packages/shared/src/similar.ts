import { z } from 'zod'

export interface SimilarCaseResult {
	caseId: number
	caseNumber: string
	documentType: string
	score: number
	breakdown: {
		entityOverlap: number
		embeddingCos: number | null
		metadataScore: number
	}
	reasons: string[]
}

export const SimilarQuerySchema = z.object({
	limit: z.coerce.number().min(1).max(100).default(20),
	alpha: z.coerce.number().min(0).max(1).default(0.4),
	beta: z.coerce.number().min(0).max(1).default(0.4),
	gamma: z.coerce.number().min(0).max(1).default(0),
})

export type SimilarQuery = z.infer<typeof SimilarQuerySchema>
