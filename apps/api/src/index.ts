import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { modules } from './modules'

const app = new Elysia()
	.state({ startTime: Date.now(), apiKey: null })
	.use(cors())
	.onError(({ request, code, error }) => {
		console.log(`Failed Incoming request: ${request.method} ${request.url} ${code}:${error}`)
	})
	.use(modules)

const port = parseInt(process.env.PORT || '3001')
console.log(`Starting API server on port ${port}`)

try {
	app.listen(port)
	console.log(`API server running on port ${port}`)
} catch (error) {
	console.error('Failed to start server:', error)
	process.exit(1)
}
