import { chunkRepository, documentRepository, hashChunkText } from '@workspace/shared'
import { createEmbeddingProvider, type EmbeddingProvider } from '../embedding'

const VERSION = 1
/** OpenAI text-embedding-3-small hard limit; also used as a conservative cap. */
const EMBEDDING_MAX_TOKENS = Number(process.env.EMBEDDING_MAX_TOKENS) || 8192
const CHARS_PER_TOKEN_ESTIMATE = 4
const MAX_CHARS = EMBEDDING_MAX_TOKENS * CHARS_PER_TOKEN_ESTIMATE

function hasEmbedding(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  return true
}

function needsEmbed(chunk: { text?: string; embedding?: unknown; embeddingModel?: string | null; chunkTextHash?: string | null }, model: string): boolean {
  if (!chunk.text) return false
  if (!hasEmbedding(chunk.embedding)) return true
  if (chunk.embeddingModel && chunk.embeddingModel !== model) return true
  const currentHash = hashChunkText(chunk.text)
  if (chunk.chunkTextHash && chunk.chunkTextHash !== currentHash) return true
  return false
}

function parentChunkIndexes(
	chunks: { chunkIndex?: number; parentChunkIndex?: number | null }[],
): Set<number> {
	const parents = new Set<number>()
	for (const chunk of chunks) {
		if (typeof chunk.parentChunkIndex === 'number') {
			parents.add(chunk.parentChunkIndex)
		}
	}
	return parents
}

function isOversized(text: string, tokenCount?: number | null): boolean {
  if (typeof tokenCount === 'number' && tokenCount > EMBEDDING_MAX_TOKENS) return true
  return text.length > MAX_CHARS
}

export async function embeddingHandler(
  job: { data: { documentId: number } },
  provider: EmbeddingProvider = createEmbeddingProvider(),
) {
  const { documentId } = job.data
  const { model, dimensions, name: providerName } = provider

  const chunks = await chunkRepository.findByDocumentId(documentId)
  if (!chunks.length) {
    console.log(`[DOC ${documentId}] embed_skipped reason=no_chunks`)
    return { skipped: true, reason: 'no_chunks' }
  }

  // Parents are expansion context only. Embed retrieval children / leaves so
  // similar-cases does not double-count overlapping parent+child text.
  const parentIndexes = parentChunkIndexes(chunks)
  const pending = chunks.filter(
    (c: any) => !parentIndexes.has(c.chunkIndex) && needsEmbed(c, model),
  )
  if (!pending.length) {
    console.log(`[DOC ${documentId}] embed_skipped reason=already_embedded count=${chunks.length}`)
    return { skipped: true, reason: 'already_embedded' }
  }

  const oversized = pending.filter((c: any) => isOversized(c.text, c.tokenCount))
  if (oversized.length > 0) {
    const details = oversized.map((c: any) => ({
      id: c.id,
      chunkIndex: c.chunkIndex,
      tokenCount: c.tokenCount ?? null,
      chars: c.text?.length ?? 0,
    }))
    console.error(
      `[DOC ${documentId}] embed_failed reason=chunk_too_large maxTokens=${EMBEDDING_MAX_TOKENS}`,
      details,
    )
    await documentRepository.addProcessingLog({
      documentId,
      action: 'embed_failed',
      details: {
        reason: 'chunk_too_large',
        maxTokens: EMBEDDING_MAX_TOKENS,
        oversized: details,
        hint: 'Re-run coref/chunking with PARALEGAL_CHUNK_MAX_TOKENS ≤ EMBEDDING_MAX_TOKENS',
      },
    })
    throw new Error(
      `Document ${documentId}: ${oversized.length} chunk(s) exceed embedding max ${EMBEDDING_MAX_TOKENS} tokens. ` +
        `Chunks are saved; re-chunk with PARALEGAL_CHUNK_MAX_TOKENS≤${EMBEDDING_MAX_TOKENS} then retry embeddings.`,
    )
  }

  console.log(
    `[DOC ${documentId}] embed_started pending=${pending.length} provider=${providerName} model=${model} dims=${dimensions}`,
  )

  const { embeddings } = await provider.embed({
    texts: pending.map((c: any) => c.text as string),
  })

  let embedded = 0
  for (let i = 0; i < pending.length; i++) {
    const chunk = pending[i] as any
    const embedding = embeddings[i]
    if (embedding) {
      await chunkRepository.updateEmbedding(chunk.id, embedding, {
        model,
        nativeDimensions: dimensions,
        textHash: hashChunkText(chunk.text),
      })
      embedded++
    }
  }

  await documentRepository.updateById(documentId, {
    embeddingVersion: VERSION,
    embeddingProvider: providerName,
    embeddingModel: model,
  } as any)

  await documentRepository.addProcessingLog({
    documentId,
    action: 'chunks_embedded',
    details: {
      count: embedded,
      provider: providerName,
      model,
      dimensions,
    },
  })

  console.log(`[DOC ${documentId}] embed_completed count=${embedded}`)
  return { embedded }
}
