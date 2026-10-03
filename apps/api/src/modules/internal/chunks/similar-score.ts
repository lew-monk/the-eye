import type { SimilarCaseResult } from '@workspace/shared'

export interface WeightedChunkHits {
	weightedSum: number
	totalWeight: number
}

export function addWeightedHit(
	aggregates: Record<number, WeightedChunkHits>,
	documentId: number,
	cosineSimilarity: number,
	positionWeight: number,
) {
	if (!aggregates[documentId]) {
		aggregates[documentId] = { weightedSum: 0, totalWeight: 0 }
	}
	aggregates[documentId].weightedSum += cosineSimilarity * positionWeight
	aggregates[documentId].totalWeight += positionWeight
}

export function meanOfMax(agg: WeightedChunkHits | undefined): number | null {
	if (!agg || agg.totalWeight <= 0) return null
	return agg.weightedSum / agg.totalWeight
}

export function similarCaseScore(entityScore: number, embeddingCos: number | null, alpha: number, beta: number, gamma: number) {
	return alpha * entityScore + beta * (embeddingCos ?? 0) + gamma * 0
}

export function similarCaseReasons(entityScore: number, embeddingCos: number | null): string[] {
	const reasons: string[] = []
	if (entityScore > 0) {
		reasons.push(`Shared participants (entity overlap: ${entityScore.toFixed(2)})`)
	}
	if (embeddingCos !== null && embeddingCos > 0) {
		reasons.push(`Similar legal substance (embedding: ${embeddingCos.toFixed(2)})`)
	}
	return reasons
}

export function toSimilarCaseResult(
	caseId: number,
	entityScore: number,
	embeddingCos: number | null,
	alpha: number,
	beta: number,
	gamma: number,
	match: { caseNumber: string; documentType: string } | undefined,
): SimilarCaseResult {
	return {
		caseId,
		caseNumber: match?.caseNumber ?? '',
		documentType: match?.documentType ?? '',
		score: Math.round(similarCaseScore(entityScore, embeddingCos, alpha, beta, gamma) * 100) / 100,
		breakdown: {
			entityOverlap: entityScore,
			embeddingCos,
			metadataScore: 0,
		},
		reasons: similarCaseReasons(entityScore, embeddingCos),
	}
}

export function asNumberArray(value: number[] | Float32Array | null | undefined): number[] {
	if (Array.isArray(value)) return value.map(Number)
	if (value instanceof Float32Array) return Array.from(value)
	return []
}
