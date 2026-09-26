/** Adapter for drizzle `db.execute` / postgres-js row lists. */
export function sqlRows<T extends object>(result: object): T[] {
	if (Array.isArray(result)) return result as T[]
	if ('rows' in result && Array.isArray(result.rows)) return result.rows as T[]
	return []
}
