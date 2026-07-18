import type { ReactNode } from 'react'
import { QueryCache, QueryClient, MutationCache } from '@tanstack/react-query'
import superjson from 'superjson'
import { TRPCClientError, createTRPCClient, httpBatchStreamLink } from '@trpc/client'
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query'
import { toast } from 'sonner'

import type { TRPCRouter } from '#/integrations/trpc/router'
import { TRPCProvider } from '#/integrations/trpc/react'

function getUrl() {
  const base = (() => {
    if (typeof window !== 'undefined') return ''
    return `http://localhost:${process.env.PORT ?? 3000}`
  })()
  return `${base}/api/trpc`
}

function redirectToLogin() {
  if (typeof window === 'undefined') return
  toast.error('SESSION_EXPIRED', {
    description: 'Authentication required. Redirecting to login...',
  })
  const redirectTo = window.location.pathname + window.location.search
  sessionStorage.setItem('redirectTo', redirectTo)
  window.location.href = '/auth/login'
}

const authErrorCache = new QueryCache({
  onError: (error) => {
    if (error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED') {
      redirectToLogin()
    }
  },
})

const authMutationCache = new MutationCache({
  onError: (error) => {
    if (error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED') {
      redirectToLogin()
    }
  },
})

export const trpcClient = createTRPCClient<TRPCRouter>({
  links: [
    httpBatchStreamLink({
      transformer: superjson,
      url: getUrl(),
    }),
  ],
})

export function getContext() {
  const queryClient = new QueryClient({
    queryCache: authErrorCache,
    mutationCache: authMutationCache,
    defaultOptions: {
      dehydrate: { serializeData: superjson.serialize },
      hydrate: { deserializeData: superjson.deserialize },
    },
  })

  const serverHelpers = createTRPCOptionsProxy({
    client: trpcClient,
    queryClient: queryClient,
  })
  const context = {
    queryClient,
    trpc: serverHelpers,
  }

  return context
}

export default function TanstackQueryProvider({
  children,
  context,
}: {
  children: ReactNode
  context: ReturnType<typeof getContext>
}) {
  const { queryClient } = context

  return (
    <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
      {children}
    </TRPCProvider>
  )
}
