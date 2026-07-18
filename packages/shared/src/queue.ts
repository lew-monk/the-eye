import { Queue } from 'bullmq'
import IORedis from 'ioredis'

export interface QueueConfig {
	redisUrl: string
}

export function getQueueConfig(): QueueConfig {
	const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

	return {
		redisUrl,
	}
}

export class BullMQClient {
	private connection: IORedis

	constructor() {
		const config = getQueueConfig()
		console.log('🔌 [BULLMQ CLIENT] Connecting to Redis:', config.redisUrl)
		this.connection = new IORedis(config.redisUrl, {
			maxRetriesPerRequest: null,
		})
		
		this.connection.on('connect', () => {
			console.log('✅ [BULLMQ CLIENT] Connected to Redis successfully')
		})
		
		this.connection.on('error', (err) => {
			console.error('❌ [BULLMQ CLIENT] Redis connection error:', err.message)
		})
	}

	getConnection(): IORedis {
		return this.connection
	}

	async close(): Promise<void> {
		await this.connection.quit()
	}

	// Utility method to get queue info
	async getQueueInfo(queueName: string): Promise<any> {
		const queue = new Queue(queueName, { connection: this.connection as any })
		const info = await queue.getJobCounts()
		await queue.close()
		return info
	}
}
