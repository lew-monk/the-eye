import { eq, and, or, desc, asc, SQL, sql } from 'drizzle-orm'
import { db } from '../database'
import { PgTable } from 'drizzle-orm/pg-core'

export interface BaseEntity {
	id: number | string
	createdAt?: Date
	updatedAt?: Date
}

export interface PaginationOptions {
	page?: number
	limit?: number
	orderBy?: 'asc' | 'desc'
	orderField?: string
}

export interface PaginatedResult<T> {
	data: T[]
	pagination: {
		page: number
		limit: number
		total: number
		totalPages: number
		hasNext: boolean
		hasPrev: boolean
	}
}

export abstract class BaseRepository<T extends BaseEntity, TInsert = Omit<T, 'id'>> {
	protected table: PgTable
	protected db = db

	constructor(table: PgTable) {
		this.table = table
	}

	async create(data: Omit<TInsert, 'id'>): Promise<T> {
		const result = await this.db.insert(this.table).values(data).returning()
		if (!result[0]) {
			throw new Error(`Failed to create ${this.table}`)
		}
		return result[0] as unknown as T
	}

	async findById(id: number | string): Promise<T | null> {
		const [result] = await this.db
			.select()
			.from(this.table)
			.where(eq((this.table as any).id, id))
			.limit(1)
		return result as T || null
	}

	async findMany(conditions: SQL[] = [], options: PaginationOptions = {}): Promise<PaginatedResult<T>> {
		const { page = 1, limit = 10, orderBy = 'desc', orderField = 'createdAt' } = options

		// Build where clause
		const whereClause = conditions.length > 0 ? and(...conditions) : undefined

		// Count total records
		const countResult = await this.db
			.select({ count: sql<number>`count(*)` })
			.from(this.table)
			.where(whereClause)
		const count = countResult[0]?.count || 0
		const totalPages = Math.ceil(count / limit)

		// Build order clause
		const orderClause = orderBy === 'desc'
			? desc((this.table as any)[orderField] || (this.table as any).createdAt)
			: asc((this.table as any)[orderField] || (this.table as any).createdAt)

		// Calculate offset
		const offset = (page - 1) * limit

		// Get paginated data
		const data = await this.db
			.select()
			.from(this.table)
			.where(whereClause)
			.orderBy(orderClause)
			.limit(limit)
			.offset(offset)

		return {
			data: data as unknown as T[],
			pagination: {
				page,
				limit,
				total: count,
				totalPages,
				hasNext: page < totalPages,
				hasPrev: page > 1,
			},
		}
	}

	async updateById(id: number, updates: Partial<T>): Promise<T | null> {
		const [result] = await this.db
			.update(this.table)
			.set({
				...updates,
				updatedAt: new Date(),
			})
			.where(eq((this.table as any).id, id))
			.returning()
		return result as unknown as T || null
	}

	async deleteById(id: number): Promise<boolean> {
		const result = await this.db
			.delete(this.table)
			.where(eq((this.table as any).id, id))
		return (result as any).rowCount > 0
	}

	async count(conditions: SQL[] = []): Promise<number> {
		const whereClause = conditions.length > 0 ? and(...conditions) : undefined
		const result = await this.db
			.select({ count: sql<number>`count(*)` })
			.from(this.table)
			.where(whereClause)
		return result[0]?.count || 0
	}

	async exists(id: number): Promise<boolean> {
		const result = await this.findById(id)
		return result !== null
	}

	// Batch operations
	async createMany(data: Omit<TInsert, 'id'>[]): Promise<T[]> {
		const result = await this.db.insert(this.table).values(data).returning()
		return result as unknown as T[]
	}

	async updateMany(conditions: SQL[], updates: Partial<T>): Promise<number> {
		const whereClause = conditions.length > 0 ? and(...conditions) : undefined
		const result = await this.db
			.update(this.table)
			.set({
				...updates,
				updatedAt: new Date(),
			})
			.where(whereClause)
		return (result as any).rowCount
	}

	async deleteMany(conditions: SQL[]): Promise<number> {
		const whereClause = conditions.length > 0 ? and(...conditions) : undefined
		const result = await this.db.delete(this.table).where(whereClause)
		return (result as any).rowCount
	}
}
