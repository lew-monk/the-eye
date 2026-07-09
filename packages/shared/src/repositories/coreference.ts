import { eq, inArray } from 'drizzle-orm'
import { BaseRepository } from './base'
import { coreferenceClusterRepository } from './coreference-cluster'
import { coreferenceMentionRepository } from './coreference-mention'
import {
	coreferenceResults,
	coreferenceClusters,
	coreferenceMentions,
	type CoreferenceResult,
	type NewCoreferenceResult,
	type CoreferenceCluster,
	type CoreferenceMention,
} from '../schemas'

export interface StoreCoreferenceInput {
	resolvedText: string
	model: string
	modelVersion: string
	sourceTextHash: string
	processedAt: string
	processingTimeMs: number
	inputCharCount: number
	chunked?: boolean
	chunkSize?: number
	chunkCount?: number
	clusters: string[][]
	mentions: {
		text: string
		start: number
		end: number
		cluster_id: number
	}[]
}

export interface CoreferenceWithDetail extends CoreferenceResult {
	clusters: (CoreferenceCluster & { mentions: CoreferenceMention[] })[]
}

export class CoreferenceRepository extends BaseRepository<CoreferenceResult, NewCoreferenceResult> {
	constructor() {
		super(coreferenceResults)
	}

	async deleteByDocumentId(documentId: number): Promise<boolean> {
		const { data } = await this.findMany([eq(coreferenceResults.documentId, documentId)], { limit: 1 })
		const result = data[0]
		if (!result) return false
		return this.deleteById(result.id)
	}

	async store(documentId: number, data: StoreCoreferenceInput): Promise<CoreferenceResult> {
		const result = await this.create({
			documentId,
			resolvedText: data.resolvedText,
			model: data.model,
			modelVersion: data.modelVersion,
			sourceTextHash: data.sourceTextHash,
			processedAt: new Date(data.processedAt),
			processingTimeMs: data.processingTimeMs,
			inputCharCount: data.inputCharCount,
			chunked: data.chunked ?? null,
			chunkSize: data.chunkSize ?? null,
			chunkCount: data.chunkCount ?? null,
		})

		for (const [clusterIndex] of data.clusters.entries()) {
			const cluster = await coreferenceClusterRepository.create({ resultId: result.id, clusterIndex })

			const clusterMentions = data.mentions.filter(m => m.cluster_id === clusterIndex)
			if (clusterMentions.length > 0) {
				await coreferenceMentionRepository.createMany(
					clusterMentions.map(m => ({
						clusterId: cluster.id,
						text: m.text,
						startPos: m.start,
						endPos: m.end,
					}))
				)
			}
		}

		return result
	}

	async findByDocumentId(documentId: number): Promise<CoreferenceWithDetail | null> {
		const { data } = await this.findMany([eq(coreferenceResults.documentId, documentId)], { limit: 1 })
		const result = data[0]
		if (!result) return null

		const { data: clusters } = await coreferenceClusterRepository.findMany(
			[eq(coreferenceClusters.resultId, result.id)],
			{ orderField: 'clusterIndex', orderBy: 'asc' as const },
		)

		if (clusters.length === 0) {
			return { ...result, clusters: [] }
		}

		const clusterIds = clusters.map(c => c.id)
		const { data: allMentions } = await coreferenceMentionRepository.findMany(
			[inArray(coreferenceMentions.clusterId, clusterIds)],
			{ orderField: 'startPos', orderBy: 'asc' as const, limit: 1000 },
		)

		const mentionMap = new Map<number, CoreferenceMention[]>()
		for (const mention of allMentions) {
			const list = mentionMap.get(mention.clusterId) || []
			list.push(mention)
			mentionMap.set(mention.clusterId, list)
		}

		return {
			...result,
			clusters: clusters.map(c => ({
				...c,
				mentions: mentionMap.get(c.id) || [],
			})),
		}
	}

	async getSourceTextHash(documentId: number): Promise<string | null> {
		const { data } = await this.findMany([eq(coreferenceResults.documentId, documentId)], { limit: 1 })
		return data[0]?.sourceTextHash || null
	}
}

export const coreferenceRepository = new CoreferenceRepository()
