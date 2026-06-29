import { embeddingHandler } from './embedding'

export const HANDLERS: Record<string, (job: any) => Promise<any>> = {
  'generate-embeddings': embeddingHandler,
  'resolve-coreference': (job): Promise<any> => {
    console.log('🔍 [COREFERENCE WORKER] Received coreference job:', job)
    return Promise.resolve(job)
  },
}
