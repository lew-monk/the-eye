import { eq } from 'drizzle-orm'
import { BaseRepository } from './base'
import { cases, type Case, type NewCase } from '../schemas'

export class CaseRepository extends BaseRepository<Case, NewCase> {
	constructor() {
		super(cases)
	}

	override async findMany(conditions: any[] = [], options: any = {}) {
		const { orderField = 'createdAt', ...restOptions } = options
		return super.findMany(conditions, { ...restOptions, orderField })
	}

	async findByCaseNumber(caseNumber: string): Promise<Case | null> {
		const result = await this.findMany([eq(cases.caseNumber, caseNumber)], { limit: 1 })
		return result.data[0] ?? null
	}

	async findActive(): Promise<Case[]> {
		const result = await this.findMany([eq(cases.status, 'active')], { limit: 500 })
		return result.data
	}
}
