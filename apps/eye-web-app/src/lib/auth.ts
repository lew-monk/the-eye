import { betterAuth } from 'better-auth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db, users, sessions, accounts, verifications } from '@workspace/shared'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { users, sessions, accounts, verifications },
    usePlural: true,
  }),
  baseURL: "http://localhost:3002",
  user: {
    additionalFields: {
      subscriptionTier: {
        type: 'string',
        required: false,
        fieldName: 'subscriptionTier',
      },
      organizationId: {
        type: 'string',
        required: false,
        fieldName: 'organizationId',
      },
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  plugins: [tanstackStartCookies()],
})
