import { embedMany } from 'ai'
import { openai } from '@ai-sdk/openai'
import { chunkRepository, documentRepository, hashChunkText } from '@workspace/shared'

const MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'
const DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS) || 1536
const PROVIDER = process.env.EMBEDDING_PROVIDER || 'openai'
const VERSION = 1
/** OpenAI text-embedding-3-small hard limit */
const EMBEDDING_MAX_TOKENS = Number(process.env.EMBEDDING_MAX_TOKENS) || 8192
/** Rough chars/token for English legal text — used only as a pre-check */
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

function isOversized(text: string, tokenCount?: number | null): boolean {
  if (typeof tokenCount === 'number' && tokenCount > EMBEDDING_MAX_TOKENS) return true
  // Conservative char estimate when tokenCount missing/stale
  return text.length > MAX_CHARS
}

export async function embeddingHandler(job: { data: { documentId: number } }) {
  const { documentId } = job.data

  const chunks = await chunkRepository.findByDocumentId(documentId)
  if (!chunks.length) {
    console.log(`[DOC ${documentId}] embed_skipped reason=no_chunks`)
    return { skipped: true, reason: 'no_chunks' }
  }

  const pending = chunks.filter((c: any) => needsEmbed(c, MODEL))
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
    `[DOC ${documentId}] embed_started pending=${pending.length} model=${MODEL} dims=${DIMENSIONS}`,
  )

  const { embeddings } = await embedMany({
    model: openai.embedding(MODEL, { dimensions: DIMENSIONS }),
    values: pending.map((c: any) => c.text),
  })

  let embedded = 0
  for (let i = 0; i < pending.length; i++) {
    const chunk = pending[i] as any
    const embedding = embeddings[i]
    if (embedding) {
      await chunkRepository.updateEmbedding(chunk.id, embedding, {
        model: MODEL,
        nativeDimensions: DIMENSIONS,
        textHash: hashChunkText(chunk.text),
      })
      embedded++
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
      count: embedded,
      provider: PROVIDER,
      model: MODEL,
      dimensions: DIMENSIONS,
    },
  })

  console.log(`[DOC ${documentId}] embed_completed count=${embedded}`)
  return { embedded }
}
