import { getDocumentQueue } from '@workspace/core'
import { documentRepository, chunkRepository, participantRepository } from '@workspace/shared'
import type { SimilarQuery, SimilarCaseResult, SimilarCasesResponse } from '@workspace/shared'

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
		if (!document) return null

		// Strip empty embedding arrays so rows stay "pending embed"
		const rows = chunks.map((c) => {
			const { embedding, ...rest } = c
			const hasVector = Array.isArray(embedding) && embedding.length > 0
			return {
				...rest,
				documentId,
				embeddingProvider,
				embeddingModel,
				ocrConfidence: c.ocrConfidence ?? document.confidence ?? null,
				...(hasVector ? { embedding } : {}),
			}
		})

		await chunkRepository.deleteByDocumentId(documentId)
		const inserted = await chunkRepository.createMany(rows)

		// Persist text chunks first. Do not mark embeddings complete when provider is "none".
		const embeddingsPending =
			embeddingProvider === 'none' ||
			embeddingVersion === 0 ||
			rows.every((r) => !('embedding' in r) || !Array.isArray((r as any).embedding) || (r as any).embedding.length === 0)

		const documentUpdates: Record<string, any> = {}
		if (normalizedText !== undefined) {
			documentUpdates.normalizedText = normalizedText
		}
		if (!embeddingsPending) {
			documentUpdates.embeddingVersion = embeddingVersion
			documentUpdates.embeddingProvider = embeddingProvider
			documentUpdates.embeddingModel = embeddingModel
		}
		if (Object.keys(documentUpdates).length > 0) {
			await documentRepository.updateById(documentId, documentUpdates as any)
		}

		await documentRepository.addProcessingLog({
			documentId,
			action: 'chunks_stored',
			details: {
				count: inserted.length,
				version: embeddingVersion,
				provider: embeddingProvider,
				model: embeddingModel,
				normalized: normalizedText !== undefined,
				embeddingsPending,
			},
		})

		// Always queue embedding job so retries can run without re-chunking
		await getDocumentQueue().addDocumentChunkToQueue(documentId)

		return { count: inserted.length, embeddingsPending }
	}

	static async getSimilar(
		targetDocumentId: number,
		opts: SimilarQuery,
	): Promise<SimilarCasesResponse | null> {
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

		const embeddingModel = target.embeddingModel ?? null
		const queryChunks = targetChunks.filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0)
		const indexIncomplete = queryChunks.length === 0

		const chunkQueries = queryChunks.map(async (chunk) => {
				if (!embeddingModel) {
					return { positionWeight: chunk.positionWeight ?? 1.0, similar: [] as Awaited<ReturnType<typeof chunkRepository.findSimilarChunks>> }
				}
				const similar = await chunkRepository.findSimilarChunks(
					asNumberArray(chunk.embedding),
					targetDocumentId,
					limit * 2,
					{ embeddingModel, nativeDimensions: chunk.embeddingDimensions ?? undefined },
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
			indexIncomplete,
			embeddingModel,
		}
	}
}

function asNumberArray(value: unknown): number[] {
	if (Array.isArray(value)) return value.map(Number)
	if (value instanceof Float32Array) return Array.from(value)
	return []
}
