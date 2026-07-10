import { initTRPC, TRPCError } from '@trpc/server'
import superjson from 'superjson'
import { auth } from '#/lib/auth'

export interface TRPCContext {
	session: {
		id: string
		expiresAt: Date
		token: string
		userId: string
	} | null
	user: {
		id: string
		name: string
		email: string
		emailVerified: boolean
		image: string | null
		subscriptionTier: string | null
		organizationId: string | null
	} | null
}

export const createTRPCContext = async (opts: { headers: Headers }): Promise<TRPCContext> => {
	const session = await auth.api.getSession({ headers: opts.headers })
	if (!session) {
		return { session: null, user: null }
	}
	return {
		session: session.session as TRPCContext['session'],
		user: session.user as TRPCContext['user'],
	}
}

const t = initTRPC.context<TRPCContext>().create({
	transformer: superjson,
})

export const createTRPCRouter = t.router
export const publicProcedure = t.procedure

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.session || !ctx.user) {
		throw new TRPCError({ code: 'UNAUTHORIZED' })
	}
	return next({
		ctx: {
			...ctx,
			session: ctx.session,
			user: ctx.user,
		},
	})
})
