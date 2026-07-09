import { DocumentQueue } from '@workspace/core'
import { documentRepository, chunkRepository, participantRepository } from '@workspace/shared'
import type { SimilarQuery, SimilarCaseResult } from '@workspace/shared'

export abstract class ChunksService {
	static async store(
		documentId: number,
		chunks: any[],
		embeddingVersion: number,
		embeddingProvider: string,
		embeddingModel: string,
		normalizedText?: string,
	) {
		const document = await documentRepository.findById(documentId)
		const queue = new DocumentQueue()
		if (!document) return null

		const rows = chunks.map((c) => ({
			...c,
			documentId,
			embeddingProvider,
			embeddingModel,
		}))

		await chunkRepository.deleteByDocumentId(documentId)
		const inserted = await chunkRepository.createMany(rows)

		const documentUpdates: Record<string, any> = {
			embeddingVersion,
			embeddingProvider,
			embeddingModel,
		}
		if (normalizedText !== undefined) {
			documentUpdates.normalizedText = normalizedText
		}
		await documentRepository.updateById(documentId, documentUpdates as any)

		await documentRepository.addProcessingLog({
			documentId,
			action: 'chunks_embedded',
			details: {
				count: inserted.length,
				version: embeddingVersion,
				provider: embeddingProvider,
				model: embeddingModel,
				normalized: normalizedText !== undefined,
			},
		})

		await queue.addDocumentChunkToQueue(documentId)

		return { count: inserted.length }
	}

	static async getSimilar(
		targetDocumentId: number,
		opts: SimilarQuery,
	): Promise<{ caseId: number; similarCases: SimilarCaseResult[] } | null> {
		const target = await documentRepository.findById(targetDocumentId)
		if (!target) return null

		const { limit, alpha, beta, gamma } = opts

		const [entityOverlapRows, targetChunks] = await Promise.all([
			participantRepository.findEntityOverlap(targetDocumentId, limit),
			chunkRepository.findByDocumentId(targetDocumentId),
		])

		const candidateAggregates: Record<
			number,
			{ weightedSum: number; totalWeight: number }
		> = {}

		const chunkQueries = targetChunks
			.filter((c) => c.embedding)
			.map(async (chunk) => {
				const similar = await chunkRepository.findSimilarChunks(
					chunk.embedding!,
					targetDocumentId,
					limit * 2,
				)
				return { positionWeight: chunk.positionWeight ?? 1.0, similar }
			})

		const chunkResults = await Promise.all(chunkQueries)
		for (const { positionWeight, similar } of chunkResults) {
			for (const row of similar) {
				const cid = row.documentId
				if (!candidateAggregates[cid]) {
					candidateAggregates[cid] = { weightedSum: 0, totalWeight: 0 }
				}
				candidateAggregates[cid].weightedSum += row.cosineSimilarity * positionWeight
				candidateAggregates[cid].totalWeight += positionWeight
			}
		}
		const entityMap = new Map<number, number>()
		for (const row of entityOverlapRows) {
			entityMap.set(row.id, row.entitySimilarity)
		}

		const candidateIds = new Set([
			...entityOverlapRows.map((r) => r.id),
			...Object.keys(candidateAggregates).map(Number),
		])

		const similarCases: SimilarCaseResult[] = []
		for (const cid of candidateIds) {
			const entityScore = entityMap.get(cid) ?? 0
			const agg = candidateAggregates[cid]
			const embeddingCos = agg && agg.totalWeight > 0
				? agg.weightedSum / agg.totalWeight
				: null

			const score = alpha * entityScore + beta * (embeddingCos ?? 0) + gamma * 0

			const reasons: string[] = []
			if (entityScore > 0) {
				reasons.push(`Shared participants (entity overlap: ${entityScore.toFixed(2)})`)
			}
			if (embeddingCos !== null && embeddingCos > 0) {
				reasons.push(`Similar legal substance (embedding: ${embeddingCos.toFixed(2)})`)
			}

			const match = entityOverlapRows.find((r) => r.id === cid)
			similarCases.push({
				caseId: cid,
				caseNumber: match?.caseNumber ?? '',
				documentType: match?.documentType ?? '',
				score: Math.round(score * 100) / 100,
				breakdown: {
					entityOverlap: entityScore,
					embeddingCos,
					metadataScore: 0,
				},
				reasons,
			})
		}

		similarCases.sort((a, b) => b.score - a.score)
		return {
			caseId: targetDocumentId,
			similarCases: similarCases.slice(0, limit),
		}
	}
}
