import { Queue } from 'bullmq'
import { BullMQClient } from '@workspace/shared'

const EMBEDDING_QUEUE = 'generate-embeddings'

export interface FailedJob {
  id: string
  documentId: number
  failedAt: string | null
  failedReason: string
}

export async function getFailedEmbeddingJobs(documentId: number): Promise<FailedJob[]> {
  const client = new BullMQClient()
  const queue = new Queue(EMBEDDING_QUEUE, { connection: client.getConnection() })

  try {
    const failed = await queue.getJobs(['failed'])
    return failed
      .filter((j: any) => j.data.documentId === documentId)
      .map((j) => ({
        id: j.id!,
        documentId: j.data.documentId,
        failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
        failedReason: j.failedReason ?? 'Unknown',
      }))
  } finally {
    await queue.close()
    await client.close()
  }
}

export async function retryFailedEmbeddingJobs(documentId: number): Promise<number> {
  const client = new BullMQClient()
  const queue = new Queue(EMBEDDING_QUEUE, { connection: client.getConnection() })

  try {
    const failed = await queue.getJobs(['failed'])
    const documentJobs = failed.filter((j: any) => j.data.documentId === documentId)
    for (const job of documentJobs) {
      await job.retry()
    }
    return documentJobs.length
  } finally {
    await queue.close()
    await client.close()
  }
}

export async function requeueFailedEmbeddingJobs(documentId: number): Promise<number> {
  const client = new BullMQClient()
  const queue = new Queue(EMBEDDING_QUEUE, { connection: client.getConnection() })

  try {
    const failed = await queue.getJobs(['failed'])
    const documentJobs = failed.filter((j: any) => j.data.documentId === documentId)

    for (const job of documentJobs) {
      await job.remove()
    }

    if (documentJobs.length > 0) {
      await queue.add('generate-embeddings', { documentId }, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      })
    }

    return documentJobs.length
  } finally {
    await queue.close()
    await client.close()
  }
}
