import { defineConfig } from 'drizzle-kit'

export default defineConfig({
	schema: './src/schemas',
	out: './src/migrations',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL || 'postgresql://legal_user:legal_pass@localhost:5432/legal_docs',
	},
})
