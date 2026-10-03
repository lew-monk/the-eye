import { startIngestionWorkers } from './modules/ingestion/worker'

const handle = await startIngestionWorkers()

async function shutdown(signal: string): Promise<void> {
	console.log(`🛑 [INGESTION WORKER] Received ${signal}, closing...`)
	try {
		await handle.close()
	} finally {
		process.exit(0)
	}
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
