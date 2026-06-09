import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schemas'

export interface DatabaseConfig {
	connectionString: string
}

export function getDatabaseConfig(): DatabaseConfig {
	const connectionString = process.env.DATABASE_URL || 'postgresql://legal_user:legal_pass@localhost:5432/legal_docs'

	return {
		connectionString,
	}
}

// Database connection
const config = getDatabaseConfig()
const client = postgres(config.connectionString)

// Drizzle instance
export const db = drizzle(client, { schema })

// Export schema for convenience
export * from './schemas'
