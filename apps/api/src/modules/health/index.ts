import { Elysia } from 'elysia'

export const health = new Elysia()
	.get('/', () => ({ message: 'API is running !' }))
	.get('/health', () => ({
		status: 'ok',
		timestamp: new Date().toISOString(),
	}))
