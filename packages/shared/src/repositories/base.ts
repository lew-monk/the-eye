import { eq, and, desc, asc, SQL, sql, getTableColumns } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { db } from '../database'

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

	protected columns() {
		return getTableColumns(this.table)
	}

	protected idColumn(): PgColumn {
		const id = this.columns().id
		if (!id) throw new Error('table has no id column')
		return id
	}

	protected orderColumn(orderField: string): PgColumn {
		const cols = this.columns()
		return (orderField in cols ? cols[orderField] : cols.id) ?? this.idColumn()
	}

	/** Drizzle `returning()` is untyped on PgTable; narrow once at this seam. */
	protected asRow(row: object): T {
		return row as unknown as T
	}

	protected asRows(rows: object[]): T[] {
		return rows.map((row) => this.asRow(row))
	}

	async create(data: Omit<TInsert, 'id'>): Promise<T> {
		const result = await this.db.insert(this.table).values(data).returning()
		const row = result[0]
		if (!row) {
			throw new Error('Failed to create row')
		}
		return this.asRow(row)
	}

	async findById(id: number | string): Promise<T | null> {
		const [result] = await this.db
			.select()
			.from(this.table)
			.where(eq(this.idColumn(), id))
			.limit(1)
		return result ? this.asRow(result) : null
	}

	async findMany(conditions: SQL[] = [], options: PaginationOptions = {}): Promise<PaginatedResult<T>> {
		const { page = 1, limit = 10, orderBy = 'desc', orderField = 'createdAt' } = options

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined

		const countResult = await this.db
			.select({ count: sql<number>`count(*)` })
			.from(this.table)
			.where(whereClause)
		const count = countResult[0]?.count || 0
		const totalPages = Math.ceil(count / limit)

		const field = this.orderColumn(orderField)
		const orderClause = orderBy === 'desc' ? desc(field) : asc(field)
		const offset = (page - 1) * limit

		const data = await this.db
			.select()
			.from(this.table)
			.where(whereClause)
			.orderBy(orderClause)
			.limit(limit)
			.offset(offset)

		return {
			data: this.asRows(data),
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
			.where(eq(this.idColumn(), id))
			.returning()
		return result ? this.asRow(result) : null
	}

	async deleteById(id: number): Promise<boolean> {
		const rows = await this.db
			.delete(this.table)
			.where(eq(this.idColumn(), id))
			.returning()
		return rows.length > 0
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

	async createMany(data: Omit<TInsert, 'id'>[]): Promise<T[]> {
		if (data.length === 0) return []
		const result = await this.db.insert(this.table).values(data).returning()
		return this.asRows(result)
	}

	async updateMany(conditions: SQL[], updates: Partial<T>): Promise<number> {
		const whereClause = conditions.length > 0 ? and(...conditions) : undefined
		const rows = await this.db
			.update(this.table)
			.set({
				...updates,
				updatedAt: new Date(),
			})
			.where(whereClause)
			.returning()
		return rows.length
	}

	async deleteMany(conditions: SQL[]): Promise<number> {
		const whereClause = conditions.length > 0 ? and(...conditions) : undefined
		const rows = await this.db.delete(this.table).where(whereClause).returning()
		return rows.length
	}
}
