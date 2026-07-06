import { embedMany } from 'ai'
import { openai } from '@ai-sdk/openai'
import { chunkRepository, documentRepository } from '@workspace/shared'

const MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'
const DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS) || 1536
const PROVIDER = process.env.EMBEDDING_PROVIDER || 'openai'
const VERSION = 1

export async function embeddingHandler(job: { data: { documentId: number } }) {
  const { documentId } = job.data

  const chunks = await chunkRepository.findByDocumentId(documentId)
  if (!chunks.length) {
    console.log(`No chunks found for document ${documentId}, skipping`)
    return { skipped: true }
  }

  // Filter to chunks that have text but no embedding yet
  const pending = chunks.filter((c: any) => c.text && !c.embedding)
  if (!pending.length) {
    console.log(`All chunks already embedded for document ${documentId}`)
    return { skipped: true }
  }

  console.log(`Embedding ${pending.length} chunks for document ${documentId}`)

  const { embeddings } = await embedMany({
    model: openai.embedding(MODEL, { dimensions: DIMENSIONS }),
    values: pending.map((c: any) => c.text),
  })

  for (let i = 0; i < pending.length; i++) {
    const chunk = pending[i] as any
    const embedding = embeddings[i]
    if (embedding) {
      await chunkRepository.updateEmbedding(chunk.id, embedding)
    }
  }

  await documentRepository.updateById(documentId, {
    embeddingVersion: VERSION,
    embeddingProvider: PROVIDER,
    embeddingModel: MODEL,
  } as any)

  await documentRepository.addProcessingLog({
    documentId,
    action: 'chunks_embedded',
    details: {
      count: pending.length,
      provider: PROVIDER,
      model: MODEL,
      dimensions: DIMENSIONS,
    },
  })

  console.log(`✅ Embedded ${pending.length} chunks for document ${documentId}`)
  return { embedded: pending.length }
}
