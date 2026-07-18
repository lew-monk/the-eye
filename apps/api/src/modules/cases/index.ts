import { Elysia, t } from 'elysia'
import { eq } from 'drizzle-orm'
import {
	caseRepository,
	documentRepository,
	participantRepository,
	caseRelationRepository,
	cases,
	type ParticipantWithCase,
} from '@workspace/shared'
import crypto from 'crypto'
import { CasesService } from './service'
import { ChunksService } from '../internal/chunks/service'

function generateCaseNumber(): string {
	const hex = crypto.randomBytes(3).toString('hex').toUpperCase()
	return `CASE-${hex}`
}

export const casesRouter = new Elysia({ prefix: '/cases' })
	.post(
		'/',
		async ({ body }) => {
			try {
				const caseNumber = generateCaseNumber()
				const doc = await caseRepository.create({
					caseNumber,
					title: body.title,
					description: body.description ?? null,
					caseType: body.caseType,
					parties: body.parties ?? null,
					tags: body.tags ?? null,
					status: 'active',
				})

				return { success: true, case: doc }
			} catch (error) {
				console.error('Case creation error:', error)
				return { error: String(error) }
			}
		},
		{
			body: t.Object({
				title: t.String(),
				caseType: t.String({ description: 'litigation | contract | investigation | other' }),
				description: t.Optional(t.String()),
				parties: t.Optional(t.Array(t.String())),
				tags: t.Optional(t.Array(t.String())),
			}),
		},
	)
	.get(
		'/',
		async ({ query }) => {
			try {
				const conditions: any[] = []
				if (query.status) {
					conditions.push(eq(cases.status, query.status))
				}
				const result = await caseRepository.findMany(conditions, {
					limit: query.limit ?? 100,
					orderField: 'createdAt',
					orderBy: 'desc',
				})
				return result.data
			} catch (error) {
				console.error('Case listing error:', error)
				return { error: String(error) }
			}
		},
		{
			query: t.Object({
				status: t.Optional(t.String()),
				limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500, default: 100 })),
			}),
		},
	)
	.get(
		'/:id',
		async ({ params, set }) => {
			try {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const c = await caseRepository.findById(id)
				if (!c) {
					set.status = 404
					return { error: 'Case not found' }
				}
				const docs = await documentRepository.findByCaseId(id)
				return { ...c, documents: docs }
			} catch (error) {
				console.error('Case fetch error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/documents',
		async ({ params, set }) => {
			try {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const docs = await documentRepository.findByCaseId(id)
				return docs
			} catch (error) {
				console.error('Case documents error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/entity-contexts',
		async ({ params, query, set }) => {
			try {
				const caseId = Number(params.id)
				const normalizedName = query.name
				if (Number.isNaN(caseId) || !normalizedName) {
					set.status = 400
					return { error: 'Invalid case id or entity name' }
				}
				console.log('getEntityMentionContexts', params, query)
				const contexts = await CasesService.getEntityMentionContexts(
					normalizedName,
					caseId,
					150,
					query.mentionIndex,
				)
				return { data: contexts }
			} catch (error) {
				console.error('Entity mention contexts error:', error)
				return { error: String(error) }
			}
		},
		{
			query: t.Object({
				name: t.String(),
				mentionIndex: t.Optional(t.Numeric()),
			}),
		},
	)
	.get(
		'/:id/entities',
		async ({ params, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}

				const docs = await documentRepository.findByCaseId(caseId)
				const totalDocsInCase = docs.length
				const result: Array<{
					id: number
					name: string
					normalizedName: string
					role: string
					roleConfidence: number | null
					mentionCount: number
					relevanceScore: number | null
					mentions: string[] | null
					documentCount: number
					totalDocsInCase?: number
				}> = []

				for (const doc of docs) {
					const parts = await participantRepository.findByDocumentId(doc.id)
					for (const p of parts) {
						result.push({
							id: p.id,
							name: p.name,
							normalizedName: p.normalizedName,
							role: p.role,
							roleConfidence: p.roleConfidence,
							mentionCount: p.mentionCount ?? 0,
							relevanceScore: p.relevanceScore,
							mentions: p.mentions,
							documentCount: 1,
							totalDocsInCase,
						})
					}
				}

				result.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
				return { data: result }
			} catch (error) {
				console.error('Case entities error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/chunks',
		async ({ params, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const chunks = await CasesService.getCaseChunks(caseId)
				return { data: chunks }
			} catch (error) {
				console.error('Case chunks error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/relations',
		async ({ params, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const relations = await caseRelationRepository.findRelationsForCaseWithDetails(caseId)
				const related = relations.map((r) => ({
					relationType: r.relation.relationType,
					entityName: r.relation.entityName,
					strength: r.relation.strength,
					metadata: r.relation.metadata,
					case: r.relatedCase,
				}))
				return { data: related }
			} catch (error) {
				console.error('Case relations error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/similar-cases',
		async ({ params, query, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}

				const docs = await documentRepository.findByCaseId(caseId)
				const processedDoc = docs.find(
					(d) => d.status === 'completed' || d.status === 'processed',
				)
				if (!processedDoc) {
					return { similarCases: [] }
				}

				const result = await ChunksService.getSimilar(processedDoc.id, {
					limit: query.limit ?? 10,
					alpha: query.alpha ?? 0.4,
					beta: query.beta ?? 0.4,
					gamma: query.gamma ?? 0,
				})

				if (!result || result.similarCases.length === 0) {
					return { similarCases: [] }
				}

				const docIds = result.similarCases.map((sc) => sc.caseId)
				const docsByDocId = new Map<number, { caseId: number | null }>()
				await Promise.all(
					docIds.map(async (docId) => {
						const d = await documentRepository.findById(docId)
						docsByDocId.set(docId, { caseId: d?.caseId ?? null })
					}),
				)

				const seen = new Set<number>()
				const caseIdsToFetch = new Set<number>()
				const resolved: typeof result.similarCases = []

				for (const sc of result.similarCases) {
					const actualCaseId = docsByDocId.get(sc.caseId)?.caseId ?? sc.caseId
					if (actualCaseId === caseId) continue
					if (seen.has(actualCaseId)) continue
					seen.add(actualCaseId)
					caseIdsToFetch.add(actualCaseId)
					resolved.push({ ...sc, caseId: actualCaseId })
				}

				const caseMeta = new Map<number, { title: string; documentCount: number }>()
				await Promise.all(
					Array.from(caseIdsToFetch).map(async (cid) => {
						const [c, docs] = await Promise.all([
							caseRepository.findById(cid),
							documentRepository.findByCaseId(cid),
						])
						caseMeta.set(cid, {
							title: c?.title ?? '',
							documentCount: docs.length,
						})
					}),
				)

				const enriched = resolved.map((sc) => {
					const meta = caseMeta.get(sc.caseId)
					return {
						...sc,
						title: meta?.title ?? '',
						documentCount: meta?.documentCount ?? 0,
					}
				})

				return { similarCases: enriched }
			} catch (error) {
				console.error('Similar cases error:', error)
				return { error: String(error) }
			}
		},
		{
			query: t.Object({
				limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 10 })),
				alpha: t.Optional(t.Numeric({ minimum: 0, maximum: 1, default: 0.4 })),
				beta: t.Optional(t.Numeric({ minimum: 0, maximum: 1, default: 0.4 })),
				gamma: t.Optional(t.Numeric({ minimum: 0, maximum: 1, default: 0 })),
			}),
		},
	)
