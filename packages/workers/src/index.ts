import { Worker } from 'bullmq'
import { BullMQClient } from '@workspace/shared'
import { HANDLERS } from './handlers'

const workers: Worker[] = []

export function registerAllWorkers(): () => Promise<void> {
  const client = new BullMQClient()
  const connection = client.getConnection()

  for (const [queueName, handler] of Object.entries(HANDLERS)) {
    const worker = new Worker(queueName, handler, { connection })
    worker.on('completed', (job) => {
      console.log(`✅ [${queueName}] Job ${job.id} completed`)
    })
    worker.on('failed', async (job, err) => {
      if (!job) return
      console.error(`❌ [${queueName}] Job ${job.id} failed (attempt ${job.attemptsMade}):`, err.message)

      if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
        const docId = job.data.documentId
        console.log(`↻ [${queueName}] Exhausted retries for doc ${docId}, keeping in failed set for manual retry`)
      }
    })
    workers.push(worker)
    console.log(`Worker listening on queue: ${queueName}`)
  }

  return async () => {
    await Promise.all(workers.map((w) => w.close()))
    await client.close()
  }
}

export { getFailedEmbeddingJobs, retryFailedEmbeddingJobs, requeueFailedEmbeddingJobs } from './queue'
