import { createFileRoute } from '@tanstack/react-router'
import { auth } from '#/lib/auth'

async function handler({ request }: { request: Request }) {
	const session = await auth.api.getSession({ headers: request.headers })
	if (!session) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	const formData = await request.formData()
	const apiUrl = process.env.API_URL || 'http://localhost:3001'

	const upstream = await fetch(`${apiUrl}/upload`, {
		method: 'POST',
		body: formData,
	})

	return upstream
}

export const Route = createFileRoute('/api/upload/$')({
	server: {
		handlers: {
			POST: handler,
		},
	},
})
