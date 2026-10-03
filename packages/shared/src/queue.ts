import { Queue } from 'bullmq'
import IORedis from 'ioredis'

export interface QueueConfig {
	redisUrl: string
}

/** Simple connection data. BullMQ thus needs no shared ioredis type. */
export interface RedisConnectionOptions {
	host: string
	port: number
	maxRetriesPerRequest: null
	password?: string
}

export function getQueueConfig(): QueueConfig {
	const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

	return {
		redisUrl,
	}
}

export function redisConnectionOptions(redisUrl = getQueueConfig().redisUrl): RedisConnectionOptions {
	const parsed = new URL(redisUrl)
	const options: RedisConnectionOptions = {
		host: parsed.hostname,
		port: parsed.port ? Number(parsed.port) : 6379,
		maxRetriesPerRequest: null,
	}
	if (parsed.password) options.password = decodeURIComponent(parsed.password)
	return options
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

	getConnectionOptions(): RedisConnectionOptions {
		return redisConnectionOptions()
	}

	async close(): Promise<void> {
		await this.connection.quit()
	}

	// Get data about one queue.
	async getQueueInfo(queueName: string): Promise<Awaited<ReturnType<Queue['getJobCounts']>>> {
		const queue = new Queue(queueName, { connection: this.getConnectionOptions() })
		const info = await queue.getJobCounts()
		await queue.close()
		return info
	}
}
