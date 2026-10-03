import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { getAzureOCRService } from '@workspace/core'
import { createEmbeddingProvider } from '@workspace/workers'
import { getObjectStorage, type ObjectStorage } from '@workspace/core'
import {
	judgmentChunkRepository,
	judgmentDocumentRepository,
	redisConnectionOptions,
} from '@workspace/shared'
import type { NewJudgmentChunk } from '@workspace/shared'
import {
	ProgressHub,
	ingestionCollections,
	resolveSummaryModel,
	startJudgmentWorker,
	type JudgmentWorkerDeps,
	type JudgmentWorkerHandle,
} from '@workspace/ingestion'
import { getStorageBytes } from './sink'
import { createDurableStore } from './service'
import { getQueuesStatus } from './queues'
import { consoleLogger } from '@workspace/ingestion'

/**
 * Synthetic document id for Azure OCR pipeline logs. Serial PKs start at 1,
 * so 0 never matches a `documents` row — `logPipelineStage` skips the
 * processing_logs insert for missing rows and `updateStatus` is a harmless
 * no-op. Judgment results persist to `judgment_documents`, never `documents`.
 */
const SYNTHETIC_DOC_ID = 0

function summaryLanguageModel() {
	const modelName = resolveSummaryModel()
	const embeddingProvider = (process.env.EMBEDDING_PROVIDER ?? 'openai').toLowerCase()
	if (embeddingProvider === 'ollama' || embeddingProvider === 'nomic') {
		const baseURL = `${process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434'}/v1`
		return createOpenAI({ baseURL, apiKey: process.env.OLLAMA_API_KEY ?? 'ollama' })(modelName)
	}
	return createOpenAI()(modelName)
}

export function createWorkerDeps(storage: ObjectStorage = getObjectStorage()): JudgmentWorkerDeps {
	const embedProvider = createEmbeddingProvider()
	return {
		store: createDurableStore(),
		docs: {
			upsertJudgment: async (row) => {
				const doc = await judgmentDocumentRepository.upsertByChecksum({
					collection: row.collection,
					source: row.source,
					sourceKey: row.sourceKey,
					relativePath: row.relativePath,
					filename: row.filename,
					sizeBytes: row.sizeBytes,
					checksum: row.checksum,
					storageKey: row.storageKey,
					status: row.status,
					jobId: row.jobId,
				})
				return { id: doc.id }
			},
			replaceChunks: async (judgmentId, chunks) => {
				await judgmentChunkRepository.deleteByJudgmentId(judgmentId)
				if (chunks.length === 0) return
				await judgmentChunkRepository.insertIgnoreConflicts(
					chunks.map(
						(chunk): Omit<NewJudgmentChunk, 'id'> => ({
							judgmentId,
							chunkIndex: chunk.index,
							text: chunk.text,
							textHash: chunk.textHash,
							embedding: chunk.embedding,
							embeddingModel: chunk.model,
							embeddingProvider: chunk.provider,
							embeddingDimensions: chunk.dimensions,
						}),
					),
				)
			},
			updateJudgment: async (id, patch) => {
				await judgmentDocumentRepository.updateById(id, {
					...(patch.status ? { status: patch.status } : {}),
					...(patch.ocrText !== undefined ? { ocrText: patch.ocrText } : {}),
					...(patch.summary !== undefined ? { summary: patch.summary } : {}),
					...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
				})
			},
		},
		sink: { getBytes: (storageKey) => getStorageBytes(storage, storageKey) },
		ocr: {
			extractText: async (bytes, _filename) => {
				const result = await getAzureOCRService().processDocumentFromBuffer(
					SYNTHETIC_DOC_ID,
					Buffer.from(bytes),
				)
				return result.content
			},
		},
		embed: {
			embed: async (texts) => {
				const result = await embedProvider.embed({ texts })
				return { vectors: result.embeddings, model: result.model, provider: result.provider }
			},
		},
		summarize: {
			summarize: async (prompt) => {
				const { text } = await generateText({ model: summaryLanguageModel(), prompt })
				return text
			},
			model: resolveSummaryModel(),
		},
		hub: new ProgressHub(),
	}
}

export function workerCollections(env: NodeJS.ProcessEnv = process.env): string[] {
	return ingestionCollections(env)
}

/** Start standalone consumers for the configured collections. */
export async function startIngestionWorkers(
	env: NodeJS.ProcessEnv = process.env,
): Promise<JudgmentWorkerHandle> {
	const log = consoleLogger('INGEST-WORKER')
	const collections = workerCollections(env)
	const concurrency = Math.max(1, Number(env.INGEST_WORKER_CONCURRENCY ?? 2))
	console.log(`🔌 [INGESTION WORKER] Consuming collections: ${collections.join(', ')} (concurrency ${concurrency})`)
	try {
		for (const status of await getQueuesStatus(collections)) {
			log.info('queue-backlog', {
				queue: status.queue,
				waiting: status.counts.waiting,
				active: status.counts.active,
				delayed: status.counts.delayed,
				failed: status.counts.failed,
			})
		}
	} catch (error) {
		log.warn('queue-backlog-unavailable', { error: error instanceof Error ? error.message : String(error) })
	}
	const handle = await startJudgmentWorker(collections, createWorkerDeps(), {
		connection: redisConnectionOptions(),
		concurrency,
	})
	console.log(`✅ [INGESTION WORKER] Listening on: ${handle.queues.join(', ')}`)
	return handle
}
