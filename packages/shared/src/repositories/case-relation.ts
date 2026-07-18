import { eq, and } from 'drizzle-orm'
import { BaseRepository } from './base'
import { caseRelations, cases, type CaseRelation, type NewCaseRelation } from '../schemas'
import type { Case } from '../schemas'

export class CaseRelationRepository extends BaseRepository<CaseRelation, NewCaseRelation> {
	constructor() {
		super(caseRelations)
	}

	async findBySourceCase(sourceCaseId: number): Promise<CaseRelation[]> {
		const result = await this.findMany([eq(caseRelations.sourceCaseId, sourceCaseId)])
		return result.data
	}

	async findByTargetCase(targetCaseId: number): Promise<CaseRelation[]> {
		const result = await this.findMany([eq(caseRelations.targetCaseId, targetCaseId)])
		return result.data
	}

	async findRelationsForCase(caseId: number): Promise<CaseRelation[]> {
		const source = await this.findBySourceCase(caseId)
		const target = await this.findByTargetCase(caseId)
		return [...source, ...target]
	}

	async findExistingRelation(
		sourceCaseId: number,
		targetCaseId: number,
		entityName: string,
	): Promise<CaseRelation | null> {
		const [id1, id2] = sourceCaseId <= targetCaseId
			? [sourceCaseId, targetCaseId]
			: [targetCaseId, sourceCaseId]

		const result = await this.findMany([
			and(
				eq(caseRelations.sourceCaseId, id1),
				eq(caseRelations.targetCaseId, id2),
				eq(caseRelations.entityName, entityName),
			)!,
		])
		return result.data[0] ?? null
	}

	async findRelationsForCaseWithDetails(
		caseId: number,
	): Promise<Array<{ relation: CaseRelation; relatedCase: Case }>> {
		const sourceRows = await this.db
			.select({
				relation: caseRelations,
				relatedCase: cases,
			})
			.from(caseRelations)
			.innerJoin(cases, eq(caseRelations.targetCaseId, cases.id))
			.where(eq(caseRelations.sourceCaseId, caseId))

		const targetRows = await this.db
			.select({
				relation: caseRelations,
				relatedCase: cases,
			})
			.from(caseRelations)
			.innerJoin(cases, eq(caseRelations.sourceCaseId, cases.id))
			.where(eq(caseRelations.targetCaseId, caseId))

		return [...sourceRows, ...targetRows] as any
	}
}
