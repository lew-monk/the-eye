import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { trpcRouter } from '#/integrations/trpc/router'
import { createTRPCContext } from '#/integrations/trpc/init'
import { createFileRoute } from '@tanstack/react-router'

async function handler({ request }: { request: Request }) {
  const contentType = request.headers.get('content-type') || ''

  if (
    request.method === 'POST' &&
    contentType.includes('multipart/form-data')
  ) {
    const url = new URL(request.url)
    const path = url.pathname.replace('/api/trpc/', '')

    if (path === 'cases/uploadDocument') {
      const formData = await request.formData()
      const documentType = formData.get('documentType') as string
      const caseId = Number(formData.get('caseId'))

      const ctx = await createTRPCContext({
        headers: request.headers,
        formData,
      })

      const caller = trpcRouter.createCaller(ctx)
      const result = await caller.cases.uploadDocument({ documentType, caseId })

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(
      JSON.stringify({ error: 'Unknown multipart endpoint' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return fetchRequestHandler({
    req: request,
    router: trpcRouter,
    endpoint: '/api/trpc',
    createContext: () => createTRPCContext({ headers: request.headers }),
  })
}

export const Route = createFileRoute('/api/trpc/$')({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
})
